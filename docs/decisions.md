# Architecture decisions & divergences log

Grows per slice. Records choices that aren't obvious from the code, and places where
the implementation diverged from the original plan.

> **Backfill note.** Slices 2 and 3 shipped without their entries here; the sections
> below were reconstructed from the code and its comments when Slice 4a landed. They
> record decisions that are evidenced in the source, not remembered intent.

## Slice 1 — walking skeleton

- **.NET 10** used instead of the originally planned .NET 8 LTS, per explicit
  direction to use the latest version. No functional impact — same ASP.NET Core /
  EF Core / SignalR APIs used throughout.
- **Theme scope narrowed to Terracotta only.** The design brief called for 5
  candidate themes; the actual Claude Design export only had Terracotta's exact
  token values finalized. Rather than guess at colors for Sandstone/Moss/Amber/Clay
  Rose, the token architecture (CSS custom properties → Tailwind `@theme`, keyed by
  `[data-theme][data-mode]`) was built to support more themes as a drop-in later,
  but only Terracotta (light + dark) is populated now.
- **Card creation is reachable via both REST and the SignalR hub**, sharing one
  `ICardOperationService` that does the actual seq-assign/persist/log/broadcast
  pipeline. The frontend only calls the REST endpoint and relies on the hub's
  group broadcast (which includes the creator's own tab) to update state — this
  keeps "who applied it locally vs. who's reconciling a broadcast" a non-issue
  for Slice 1, since there's no optimistic UI yet (that's Slice 2).
- **PostgreSQL and the .NET SDK were not present on this machine** and were
  installed as part of this slice (PostgreSQL 17 native install, .NET 10 SDK via
  winget) rather than using Docker, since Docker Desktop wasn't running locally.

## Slice 2 — drag-and-drop and full CRUD

- **`ICardOperationService` became `IBoardOperationService`.** Once columns needed
  the same pipeline as cards, a card-shaped service was the wrong seam. One service
  now owns all eight operation types, so REST and any future hub-invoked path
  produce identical broadcast shapes.
- **Mutations are REST-only; the hub reverted to broadcast-only.** Slice 1's
  dual-path card creation was dropped. With one write path there is exactly one
  place enforcing authorization and assigning `seq`, which matters more than the
  round-trip saved by invoking the hub directly.
- **Optimistic UI reconciles rather than diffs.** A dragged card is placed at its
  drop index immediately, and the authoritative broadcast that follows replaces it
  by id with the server-computed rank. Every operation is idempotent — replacing
  state by id rather than appending — so re-applying the same broadcast is
  harmless, which is what makes resync (Slice 3) safe.
- **Failed moves roll back to a snapshot** taken before the optimistic update,
  rather than attempting an inverse operation. Simpler, and correct even when the
  server rejected the move for a reason the client didn't predict.
- **`EnsureCanMutateAsync` added as an authorization hook** ahead of the UI that
  would need it. It rejected `Viewer`, but nothing could produce a Viewer until
  Slice 4a, so the branch was unreachable in practice — see below.

## Slice 3 — presence, cursors, resync

- **Presence is an in-memory singleton, not Redis.** Correct for one instance and
  avoids standing up infrastructure the project doesn't otherwise need; the
  multi-instance version is deferred to Slice 5. This is the main thing blocking
  horizontal scaling today.
- **Presence counts connections per user, not users.** Two tabs from one person
  would otherwise make them flicker out of the roster when either tab closed.
  Join/leave broadcasts fire only on the first and last connection.
- **Resync replays a delta, with a 200-operation cliff.** Past that gap, replaying
  is slower than refetching, so the server returns `needsSnapshot` and the client
  refetches the board. The threshold is a judgement call, not a measured one.
- **Operation payloads are materialized before parsing.** `JsonDocument.Parse`
  can't be translated to SQL, so the resync query pulls raw rows and parses
  server-side rather than trying to project JSON in the query.
- **Cursor updates are throttled client-side to 50 ms** and sent as viewport
  percentages, so they survive different window sizes. They are relayed to others
  only, never echoed to the sender.
- **Cursor sending is gated on `JoinBoard` completing**, not on the transport
  reporting `Connected`. `start()` can resolve before the server has associated the
  connection with a board, in which case the hub has no board context and the
  update silently no-ops.

## Slice 4a — membership, invites, sign-up

- **The product couldn't host two people until this slice.** `Membership` rows were
  only ever created by `WorkspacesController.CreateWorkspace`, always as `Owner`,
  always for the creator. Presence, cursors and the sync spine could only be
  exercised by one user in two tabs, and `MembershipRole.Viewer` was unreachable —
  a non-member 404s on the query filter before the role check runs. Slice 4a is what
  makes the previous three slices demonstrable.
- **Hybrid invites over an invite-only-existing-users model.** `POST …/members`
  takes an address: if a user already has it, the membership is created immediately;
  otherwise an `Invitation` row is written and claimed on that person's first
  authenticated request. Invite-existing-only would have been simpler but has a
  chicken-and-egg flow — the invitee must sign up and report back before they can be
  added.
- **Claiming runs inside `CurrentUserLoader`, before workspace ids are resolved.**
  Ordering is load-bearing: claim after that point and the newly joined workspace
  stays invisible until the *next* request. The cost is one indexed lookup on every
  authenticated call, guarded by "user has an email".
- **Concurrent claims are absorbed by the existing unique index** on
  `(workspace_id, user_id)` rather than a lock or a transaction. Two simultaneous
  requests from the same user can both try; the loser catches `DbUpdateException`
  and re-reads.
- **`Invitation` carries the same tenant query filter as everything else**, and the
  claim path is the single caller that bypasses it with `IgnoreQueryFilters()` —
  necessarily, since the invitee has no membership yet. Keeping the filter means the
  owner-facing list and revoke endpoints get isolation for free.
- **Emails are stored normalized (lowercase, trimmed)** on both `User` and
  `Invitation`, with one `EmailAddress.Normalize` used by both sides. Claim matching
  is an exact index hit; without shared normalization, inviting `Sam@Example.com`
  silently never resolves for someone who signed up as `sam@example.com`.
- **`User.Email` is nullable with a unique index.** Not every provider supplies an
  email, and Postgres permits multiple NULLs under a unique index. Email and display
  name are refreshed on *every* load, not just on create, so rows predating this
  slice can still be invited.
- **Sign-up forces a token refresh after `updateProfile`.** Firebase does not
  invalidate the ID token it just minted, so without `getIdToken(true)` the backend's
  first upsert sees no `name` claim and permanently derives the display name from the
  email local-part — which is what presence avatars and cursor labels render.
- **Board landing asks the server, not `localStorage`.** The old bootstrap created a
  workspace whenever local storage was empty, so an invited user would have silently
  created their own private workspace instead of landing on the shared board.
  `localStorage` is now only a "last board opened" preference, validated against the
  workspaces the server returns.
- **Last-owner rules are enforced server-side and mirrored in the UI.** The server
  rejects demoting or removing the final owner; the client disables those controls
  when it can already tell, rather than letting the user click and collecting a 400.
- **No email delivery and no tokenised invite link.** Both were considered and
  deferred. The stopgap is a copy-to-clipboard invite message containing a
  `/signup?email=…` link, which the owner sends themselves. Prefilling the address
  is a correctness measure, not a convenience — claiming matches exactly.

## Slice 4b — viewer read-only UI

- **The board reports the caller's role, not the board's.** `BoardDetailResponse`
  gained a `Role` field resolved per request via `IMembershipService`. Two people
  fetching the same board get different values — that asymmetry is the whole point,
  and it's what the test asserts.
- **Controls are removed for viewers, not disabled.** A greyed-out button reads as
  "not right now"; the truth is "not you, ever, on this board". `disabled` stays
  reserved for the transient case where the connection dropped and the ability is
  coming back, so the two states remain distinguishable.
- **Viewers keep presence, cursors and live updates.** Read-only restricts
  origination, not participation — they still appear in the roster and see other
  people's cursors, which is most of the value of a shared board for someone whose
  job is to watch it.
- **Card detail uses `readOnly`, not `disabled`.** `disabled` greys out text and
  blocks selection; a viewer is entitled to read and copy card content at full
  contrast. Save and Delete are removed and replaced with a line explaining why,
  so the footer doesn't just look empty.
- **Drag is refused in three places:** `useSortable({ disabled })`, omitting the
  drag listeners and ARIA attributes entirely so nothing announces itself as
  movable, and an early return in `handleDragEnd` so the optimistic update can
  never run for a viewer. The server rejects it regardless; this is about not
  showing an affordance that lies.
- **The header carries a "View only" badge.** Without it a viewer sees a board that
  looks like it's missing features rather than one that's deliberately restricted.

## Slice 5 — CI and deployment

- **The test suite was made self-sufficient before CI existed, not after.**
  `Program.cs` reads `Firebase:ProjectId` before `builder.Build()`, which is
  earlier than `WebApplicationFactory` can inject configuration, and the test
  project's content root isn't the API project's. The suite therefore needed a
  developer's user-secrets and failed on a fresh clone — which is precisely what
  a CI runner is. A module initializer in the test assembly seeds the environment
  variable before the first test class is constructed. `dotnet test` now works
  with no setup at all.
- **"No credit card" was the binding constraint, not price**, and it took four
  attempts to satisfy. Koyeb was chosen first on the strength of comparison
  sites describing a healthy no-card free tier — Mistral had acquired them in
  February 2026 and closed the Starter plan to new signups. Northflank went the
  same way: third-party pages said "no credit card", its own billing docs
  require a payment method "even on the free plan". Back4App got as far as a
  running container before revealing an undocumented 60-minute URL expiry.
  Render finally worked.
- **The lesson is narrow and reusable: for facts that decide a platform, only
  the vendor's own current pages count.** Every wrong turn came from trusting a
  comparison article over the provider.
- **Rejecting Render for "no WebSockets on free" was the actual mistake.**
  SignalR negotiates transports and degrades to Server-Sent Events, then long
  polling; the board syncs either way, just with more HTTP round trips.
  Treating a performance characteristic as a hard capability blocker cost three
  platforms and most of a day. The check that would have caught it — "does this
  break the feature, or make it slower?" — is worth asking before any platform
  filter.
- **Container footprint was measured, not assumed.** Free tiers advertise as
  little as 256 MB, which sounds impossible for ASP.NET Core. Running the image
  under a hard `--memory=256m` cap while serving requests: 26 MB, no OOM. The
  .NET GC sizes itself to the cgroup limit, so RAM never was the constraint.
- **Cold starts are accepted rather than worked around.** Free tiers idle out.
  Rather than add a keep-alive pinger — which fakes traffic to defeat the
  platform's own economics — the reconnect path from Slice 3 absorbs it:
  automatic reconnect, then `Resync` from the last seen `seq`, with a snapshot
  fallback past a 200-operation gap. SignalR also negotiates down to SSE and
  long polling if a host ever lacks WebSockets, so transport support stopped
  being a hard platform filter.
- **Migrations run at startup, behind an opt-in flag.** There's no shell in the
  deployed environment to run `dotnet ef database update` from. This is only
  safe because the free tier is a single instance; several instances booting
  together would race on the migration history table, so the comment in
  `Program.cs` says so explicitly.
- **Deploys are driven from CI, with both platforms' git integrations disabled.**
  Back4App and Vercel would each happily deploy on a red build. Gating them behind
  the test job is the only reason CI has teeth.
- **The deploy branch is the gate, for both hosts.** Each builds whatever lands
  on the branch it watches, so pointing either at `main` would have deployed on
  red and made CI decorative. Render watches `deploy` and Vercel's production
  branch is set to it; CI advances that branch only once both test jobs pass.
  The gate is the branch rather than the trigger, so the repository holds no
  deploy credentials at all. `--force-with-lease` so a hand-push to `deploy`
  fails loudly rather than being silently discarded.
- **Deploy order is the reason both halves are manual, not tidiness.** The two
  share an API contract, and only one order is safe: an API returning extra
  fields doesn't break an old frontend, while a frontend reading a field the
  deployed API doesn't send yet does break. With both hosts watching `deploy`
  and Vercel on auto, the frontend always won the race — Render can only build a
  commit that is already on `deploy`, which means CI has run, which means Vercel
  has already shipped. Ordering was unobtainable until the frontend became
  manual. Hence the third branch, and the fact that the two hosts watch
  *different* ones: CI advances `deploy` (Render's branch), and `git ship`
  promotes it to `release` (Vercel's branch) afterwards. Pointing Render at
  `release` too would collapse the distinction and put the frontend back in
  front.
- **Vercel's Ignored Build Step is not a way to make deploys manual.** Setting
  it to "Don't build anything" also cancels manually created deployments —
  confirmed by testing rather than by documentation, which does not say so
  either way: a Create Deployment from `deploy` returned "Build Canceled … as a
  result of running the command defined in the Ignored Build Step setting". Had
  this been assumed rather than tested, the frontend would have been left with
  no deployment path at all.
- **The frontend originally deployed from CI via the Vercel CLI, and that was
  over-engineered.** It needed three repository secrets and a build step to
  achieve what setting Vercel's production branch to `deploy` does by itself —
  and because the secrets were never added, the step silently skipped on every
  run while Vercel's own git integration deployed from `main` ungated. The
  simpler mechanism is also the one that actually holds: fewer moving parts,
  no tokens, and one mental model shared with the backend.
- **Redis-backed presence was dropped from the slice.** It solves multi-instance
  inconsistency, and free hosting gives exactly one instance — so it would have
  been code no deployment exercises. `IPresenceTracker` stays shaped for the
  swap and the README records it as the scaling limit.

## Sign-out

Shipped late — the app had sign-in and sign-up from Slice 4a but no way out,
which nobody noticed until someone tried to switch accounts.

- **Navigation lives inside the auth provider's `signOut`, not at the call
  sites.** Not every page reacts to `user` going null on its own; `BoardView`
  simply returned early and would have left you sitting on a board you could no
  longer load. Redirecting centrally means a sign-out can't half-happen.
- **`BoardView` also redirects when the session disappears.** Sign-out navigates
  away by itself, so this covers the other case: a token revoked or expired
  elsewhere.
- **The remembered board id is cleared on sign-out.** The landing page already
  validates it against the server, so a stale value was harmless — but leaving it
  behind tells the next person on that browser which board the last one had open.
- **The menu is positioned `fixed`, anchored off the trigger's measured rect.**
  Both page shells are `overflow-hidden`, which clips an absolutely positioned
  dropdown inside the header. Fixed escapes the clip without pulling in a portal.
  The anchor is measured once on open, so scroll and resize close the menu rather
  than leaving it stranded.

## v2 phase 1, scope C0 — accessibility

Three violations of `docs/ui-standards.md` §S5 that the standard itself made
visible. Correctness failures, not polish, so they went first.

- **`useDialog` is shared, not duplicated per overlay.** `ConfirmDialog` already
  had Escape, focus restore and containment; `CardDetailPanel` had none of it.
  Copying would have left two implementations to keep in step, and the failure
  mode here is invisible — an overlay missing the trap looks perfect and simply
  drops the keyboard user onto the page behind it. `ConfirmDialog` moved onto the
  hook, which also fixed a latent bug: its two-way Tab cycle assumed exactly two
  focusable controls, so a link inside `body` would have escaped it.
- **The trap re-queries focusables on every Tab.** A list captured at mount goes
  stale as the dialog's own controls change — Save enables once dirty, Delete
  disables mid-request.
- **`onClose` is held in a ref.** Callers pass inline arrows; depending on it
  directly would re-run the effect every render, re-firing initial focus and
  yanking the caret back to the top of the dialog on every keystroke.
- **Escape on the card panel does not guard unsaved edits.** Click-outside
  already discarded them, and guarding one but not the other would make the panel
  inconsistent about when it protects your work. Both are C3's job.
- **Space picks a card up, Enter opens it.** The card became a real `<button>`,
  which is what makes it tabbable — but a button's implicit click and dnd-kit's
  keyboard activation both want the same keys. dnd-kit `preventDefault`s whatever
  is listed in `keyboardCodes.start`, so restricting `start` to `Space` is
  precisely what stops Space also firing the click. Leaving Enter in `start`
  (the default) would give keyboard users drag but no way to open a card. Rejected
  the alternative — a separate grab handle — because it would have narrowed
  pointer drag from the whole card to a grip nobody asked to hunt for.
- **The delete-column button is faded, not `hidden`.** `display: none` cannot take
  focus, so delete was mouse-only. The reveal had to move to a wrapper element:
  `opacity-0` on the button itself collides with its own `disabled:opacity-50`,
  and the variant wins — which would have shown a delete button on every column
  whenever the connection dropped. Two elements, two independent opacities.
- **Escape during a column rename needs a ref guard.** Leaving the field fires
  `onBlur`, and `onBlur` commits — so without the flag, cancelling would have
  saved the very edit it was meant to discard.

Verified against the running app: dialog semantics, both wrap directions of the
focus trap, Escape, and focus returning to the exact card that opened the panel;
rename discarding on Escape; delete and rename reachable with `tabIndex` 0 while
the reveal wrapper is transparent. The keyboard-drag key split is verified from
dnd-kit's source and the generated CSS rather than by keystroke — Chrome
suppresses focus styling and drops synthesized keys while its window is not
focused, so `document.hasFocus()` was false throughout.

## v2 phase 1, scope C5 — loading states

- **The board loads as its own silhouette, not a centred "Loading board…".**
  The old state told you nothing and then shoved the entire page aside on
  arrival. Measured on the running app: header top/height and the first column's
  left/top/width are identical between skeleton and loaded board, so nothing
  moves (S2.2, S6.2).
- **The skeleton draws the real header, not a placeholder strip.** 52px of chrome
  whose position never depends on the response — faking it would only add a
  second thing that can be wrong.
- **The bootstrap page shows the same silhouette.** `/board` redirects into
  `/board/[id]`, so a different loading screen there would flash a second,
  unrelated wait on the way through.
- **`Skeleton` carries no default radius.** `className` is appended, and a second
  `rounded-*` is decided by stylesheet order rather than argument order (S1.3) —
  the members list needs `rounded-full`, the cards need `rounded-[8px]`.
- **The slow-load note is absolutely positioned.** It appears several seconds in
  and disappears on arrival; in the flow it would push the columns down and then
  yank them back, so explaining the wait would itself have caused two layout
  shifts (S6.2).
- **Reduced motion collapses durations rather than setting `animation: none`.**
  `none` strands an element on its *initial* keyframe, and the card panel
  animates in from `opacity: 0` — it would never appear. `!important` is load
  bearing: the sync dot sets its animation inline, and nothing else outranks
  that.
- **Board and column empty states were left to C2.** They belong next to card
  visuals and the drag affordance, and splitting them across two changes would
  mean designing the same surface twice.

## v2 phase 1, scope C2 — board view

- **Creates get a placeholder, not an optimistic row.** Moves, renames and
  deletes apply optimistically because the client already knows the result. A
  create does not: the server assigns both the id and the fractional rank, and
  inventing a temporary id would leave a duplicate on screen until the broadcast
  arrived, because `applyOperation` replaces by id. A dashed "Adding…" card is
  the honest version — it says the card is on its way without pretending it
  exists. Same reasoning for a new column.
- **An empty column now states it is a drop target.** It was blank space, so a
  card being dragged had nothing to aim at — the fix serves S2.3 and the drag
  affordance at once.
- **The empty board explains what a column is.** It previously rendered as one
  dashed button in the top-left corner, which reads as a broken layout rather
  than a starting point. Viewers get the explanation without the control (S8.1).
- **Card text is clamped** — three lines of title, two of description. One long
  paragraph used to grow a card tall enough to push the rest of the column out
  of view.
- **The drag grip reveals on `group-focus-visible` as well as hover.** A
  `cursor-grab` is invisible until you are already over the card, and useless to
  a keyboard user; revealing on focus puts the hint on screen at the moment the
  drag keys become live.
- **Theme moved into the account menu.** The board header was carrying seven
  clusters and three dividers. Theme is a personal preference rather than a board
  action, so it belongs with the account — the standalone `ThemeToggle` stays for
  sign-in and sign-up, which have no account menu. Two dividers now.

Verified against the running app: both empty-state variants and their copy, the
grip hidden at `opacity: 0` until `group-hover`/`group-focus-visible`, the
clamps, and the theme item flipping `data-mode` and the page background. The
pending placeholder needed a MutationObserver to catch — a 403 on localhost
returns faster than a 40 ms poll, and the first attempt wrongly showed nothing.
That same run confirmed the failure path end to end: placeholder, then "You
don't have permission to add that card", then no card added.

## v2 phase 1, scope C3 — card detail

- **Deleting a card now asks first.** It was the one destructive action in the
  app that committed on the first click, while deleting a *column* — strictly
  less destructive — already confirmed (S4.2).
- **The unsaved guard covers every exit.** Escape, the close button and the
  overlay all route through one `requestClose`. Guarding only one of them is
  worse than guarding none: you learn to trust it, then lose an edit through the
  route that wasn't covered.
- **`useDialog` gained a `paused` flag.** Both the panel and its confirmation
  listen on `document`, so a single Escape would have dismissed the
  confirmation *and* the panel underneath — discarding the exact edit the
  confirmation existed to protect. Paused rather than unmounted, because tearing
  the effect down runs its cleanup and hands focus back to the trigger
  mid-confirmation.
- **Cmd/Ctrl+Enter saves.** The panel is two text fields, so a bare Enter can't
  mean save.
- **The shortcut label is read during the first render, not in an effect.** Safe
  from hydration mismatch because the panel only ever mounts in response to a
  click, and the lint rule against `setState` in an effect is right to object.

### jsdom, and why the rule changed

Frontend tests were node-only, with "components needing a DOM were verified in a
real browser instead" as the justification. That justification held only while a
browser was actually available. It stopped holding: focus traps and Escape
handling need a *focused window*, and both an unattended browser and this
project's in-app one report `document.hasFocus() === false` — real keystrokes
never arrive and focus styling never paints. The browser could confirm structure
but not behaviour, which is the half that breaks.

So jsdom is now opt-in per file. Two things cost real time to discover:

- **`afterEach(cleanup)` is not optional.** Testing Library auto-registers
  cleanup only when Vitest globals are on, and they are not here. Emptying
  `document.body` by hand leaves the React root mounted, so a previous test's
  dialog keeps its `document` keydown listener and fights the next test for Tab.
  This produced a genuinely confusing failure: interior Tab landed on the wrong
  control, and the hook was innocent.
- **The pool had to move from `forks` to `threads`.** Booting jsdom inside a
  forked child exceeded the worker startup timeout on Windows, and the run died
  before a single test executed.

## v2 phase 1, scope C4 — auth pages

- **A session-checking state (S2.1).** Firebase resolves a stored session
  asynchronously, so both pages rendered a full sign-in form to someone who was
  already signed in and then redirected out from under them. Indistinguishable
  from having been logged out.
- **Sign-up treats mid-sign-up separately.** `user` goes non-null the instant the
  account is created, before the profile update finishes — so "signed in" cannot
  by itself mean "swap to the checking state", or a failure right after account
  creation would hide its own error message.
- **`submitting` drives that, not the existing ref.** The ref has to be set
  synchronously before the first `await`, which is why it exists — but a ref read
  during render doesn't re-render when it changes, so the shell would keep
  whichever value it first saw. Lint catches this; it was right to.
- **Placeholder-only fields became labelled fields (S5.6).** A placeholder
  vanishes as you type, so the one field that most needs its label — the password,
  with a requirement attached — lost it exactly when you started meeting it.
- **The password rule is shown and ticked live**, and the submit button is
  disabled until it passes. The requirement is knowable in the browser, so making
  someone submit to discover it is a round trip that existed only because the UI
  stayed quiet.
- **"Offline-tolerant sync" is gone from the sign-in page.** It was not true: the
  app replays operations since the last seen `seq` on reconnect, but it never
  queued mutations made while offline. Now "Replays what you missed on
  reconnect", which is accurate and describes the harder thing anyway.

## v2 phase 1, scope C1 — onboarding

The board demonstrates itself. A phantom teammate adds a card, drags it to the
next column, and then says what you just saw. The one property of this app a
screenshot cannot convey is that someone else's edits arrive while you watch, so
the introduction *shows* it rather than describing it.

- **Nothing it draws is real.** The card and cursor live on an overlay and never
  reach the API, so a first run leaves no rows behind and a reload midway has
  nothing to clean up. The alternative — actually creating and moving a card —
  would have meant deleting it afterwards, and a failed delete would leave
  someone's board seeded with fake work.
- **Positions are measured, not derived.** The demonstration reads
  `[data-intro-dropzone]` rather than recomputing the column width and gap, which
  would desynchronise the moment either constant changed in `BoardColumn`, with
  nothing failing loudly.
- **It bails out rather than guessing.** Fewer than two measurable columns means
  there is nowhere to move a card *to*, and a demonstration landing in the wrong
  place is worse than none.
- **Reduced motion gets the ending, not the animation** (S6.1). A self-playing
  sequence is exactly what the preference asks not to see, so it jumps straight
  to the closing panel. `usePrefersReducedMotion` uses `useSyncExternalStore` so
  there is no first paint at the wrong value.
- **Skip is present from the first frame.** An introduction you have to sit
  through is a worse first impression than no introduction.
- **It ends by handing you the control it was about**, opening the first column's
  add-card form rather than closing on a dialog and leaving you to find it.
- **Shown only on a board with columns and no cards**, and never to a viewer. On
  a board with real work the phantom card reads as a bug, and a viewer cannot act
  on anything it suggests.

### Machinery built for C6

The walkthrough was deferred on the condition that C1's parts be reusable. They
are, and they are separately tested:

- **`useSeenOnce`** — per-browser "has this been shown", starting at `unknown`
  rather than `unseen`, because guessing `unseen` would flash the introduction at
  someone who dismissed it months ago. Blocked storage is treated as *seen*: of
  the two wrong answers, replaying forever is the more annoying one.
- **`useSequence`** — one state machine for both clocks. A `null` hold means
  "wait for `next()`", which is what makes a manual, user-driven walkthrough fall
  out of the timed version for free.
- **`usePrefersReducedMotion`** — for the cases CSS cannot reach. The global rule
  in `globals.css` makes declarative animation instant; a scripted sequence on
  timers has to be told not to run at all.

A note for whoever writes the C6 tests: advancing fake timers past several beats
in one jump only fires the first. Each subsequent timer is scheduled by an effect
that cannot run until React has re-rendered, by which point the whole window has
already elapsed. Advance one beat per `act`.

## v2 phase 1, scope C6 — guided walkthrough

Built last, as planned, and the dependency recorded when it was deferred paid
off: `useSequence` carried it unchanged, because a `null` hold already meant
"wait for the user" — the manual mode *is* the timed mode with a different
clock. `Spotlight` was the only new piece.

- **On demand only, from the account menu.** The reason it was deferred — that a
  tour and a self-assembling first board are two answers to the same question
  about someone's first minute — did not stop applying once it existed. It is a
  refresher for whoever asks.
- **Steps with no anchor are dropped, not shown.** The board's contents vary: no
  cards yet, a viewer with no add button. A step spotlighting nothing reads as a
  broken feature, and an empty tour dismisses itself instead of opening.
- **The step count reflects what will actually be shown**, so "1 of 3" never
  becomes "1 of 5" with two steps skipped silently.
- **The cut-out is one outward `box-shadow`**, not four panels or an SVG mask —
  no seams to line up, and it moves as a unit with its target.
- **Scroll is captured, not bubbled.** The columns scroll independently of the
  window, so a spotlight listening only for window scroll would drift off its
  target the moment a column moved.
- **The panel flips above its target when there is no room below**, and is
  clamped on both axes, so a step anchored near an edge stays readable.
- **The tour is *not* offered on the members page.** `UserMenu` takes the handler
  as an optional prop and simply omits the item — a tour that leads nowhere is
  worse than none.

A note on the tests: `document.body.innerHTML = …` survives Testing Library's
cleanup, which only removes containers it created. Doing that in one test left
anchors behind and made three later tests fail against a DOM they never
rendered. `availableSteps` takes a root parameter partly so that test can use a
detached node.

## v2 phase 2, feature 1 — activity feed and undo

The leverage was real: the append-only `operations` table already carried
`ActorId`, `OpType`, the payload and a per-board `Seq`. The feed is a projection
of it. Undo was not free, and the reason is worth recording.

**The stored payload cannot produce an inverse.** It records the state a
mutation produced, never the state it replaced. A rename stores the title it
changed *to*; nothing anywhere held the title it changed *from*. So the inverse
is now computed and stored at write time, in `inverse_op_type` /
`inverse_payload`, captured before the mutation is applied.

- **Deleting a column snapshots its cards.** The database cascade takes them,
  and the operation payload holds only the column id — so without the snapshot,
  undo would restore an empty column and silently lose the work inside it, which
  is precisely the deletion people most want back.
- **The inverse vocabulary is internal.** `card.restore` and `column.restore`
  never reach a client. Restores are broadcast as ordinary `create` operations
  carrying the original id, and the reducer already replaces state by id — so
  undo added no new case to the frontend at all.
- **Restoring a column emits several operations in one transaction**, column
  first and then each card. A client receiving a card for a column it doesn't
  know about would drop it, so the order is load-bearing, and a failure halfway
  would otherwise leave the column back but its cards gone.
- **An undo is recorded without an inverse.** That is what stops undo becoming
  redo, and then a loop.
- **You can only undo your own operations.** Reversing someone else's edit out
  from under them is a different feature with a different conversation attached.
  The feed marks other people's entries as not undoable rather than hiding them.
- **A stale target is a 409, not a 404.** The request was well-formed; the board
  moved on. `friendlyError` already maps 409 to "Someone else changed this
  first", which is exactly what happened.
- **Viewers can read the feed but not undo.** Watching the board is what the
  role is for, and its history is part of watching it.
- **Summaries are composed server-side**, because the client cannot: a delete's
  payload carries only ids, and the name worth showing lives in the inverse
  recorded beside it.

On the client:

- **Cmd/Ctrl+Z opens the panel rather than undoing outright.** Undo here is a
  server round trip everyone else sees immediately; a keystroke that fires it
  blind, with no chance to see what it caught, is the wrong trade. The panel
  names the change first. The shortcut also stands down inside text fields,
  where the browser's own undo is what the user means.
- **The feed follows `board.seq`.** Every mutation from anyone advances it, so
  the panel refreshes without polling. The fetch is cancellation-guarded: a
  burst of operations starts several requests, and without the guard the slowest
  one wins and paints a feed older than the board.
- **"Undone" is said, not only struck through.** A strikethrough reads
  identically to a screen reader.

`relativeTime` moved to `lib/` on the way past — the members page had grown its
own copy, and two implementations of "how long ago" drift invisibly until two
surfaces disagree about one timestamp.

## v2 phase 2, feature 2 — workspace and board management

`/board` opened your first board and there was no way to have or reach a second,
so the multi-tenant model the backend already enforced was invisible from the
app. `/boards` is the surface that makes it real.

- **Archive, not delete.** A board holds every card anyone wrote on it, and "put
  it away" is what people almost always mean. Archived boards keep their rows,
  their operations and their undo history, and stay reachable by URL.
- **Archived boards are returned flagged, not filtered out.** A board that
  vanished from the listing with no trace would read as data loss and offer no
  way back. The home screen files them behind one disclosure.
- **The last active board cannot be archived.** Otherwise the home screen's only
  option is "create a board", with no route back to the work that was there.
  Same shape as the last-owner rule.
- **Archiving is owner-only; renaming is not.** Renaming is a board-level edit,
  so it follows the same rule as renaming a column. Archiving changes what the
  whole workspace sees on its home screen, which puts it with the other
  membership-shaped decisions.
- **Creating a board was previously unchecked.** Any member could do it,
  including a viewer who then could not put anything on the board they had just
  made. Now the same owner/editor rule as every other content mutation.
- **Boards are listed most-recently-touched first**, which is what makes the
  home screen useful rather than merely chronological.
- **A new board opens immediately.** Creating one and then being left on a list
  to go and find it is a step nobody wants.
- **The board header gained a breadcrumb back to `/boards`.** Before this a
  board was a dead end.

### Unverified at time of writing

`BoardManagementTests` (10 tests) is written and compiles, but **has not been
run**: Docker Desktop's Linux engine stopped partway through this work and would
not restart unattended, so `tangram-pg` was unreachable and every integration
test fails at the fixture. The frontend is fully verified — 169 tests, lint and
build green. Run `dotnet test` once Docker is back before treating the backend
half as done.

### Divergences and known debt from Slice 4a

- **The test suite needs `Firebase:ProjectId` from the environment or user-secrets.**
  `Program.cs` reads it before the host is built, which is earlier than
  `WebApplicationFactory` can inject configuration, and an MSBuild workaround in the
  test project pins the content root away from the API project's `appsettings.json`.
  Documented in the README rather than fixed.
- **Focus rings need `data-focus-ring="none"`, not a Tailwind utility.** The global
  ring in `globals.css` is unlayered, and unlayered declarations outrank anything in
  `@layer utilities` regardless of specificity — so `focus-visible:shadow-none` can
  never override it. Composite fields opt out via the attribute instead.
- **`cn()` is a plain join with no Tailwind conflict resolution.** Components that
  accept a `className` for a field either replace the default classes wholesale
  (`PasswordInput`) or pick per-branch variants (`InviteRecipientsInput`), because
  appending a second `border-*` leaves the winner to stylesheet order. `Input` and
  `PasswordInput` still have a latent case where an `error` border loses to
  `focus-visible:border-accent`.
