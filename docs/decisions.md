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

## v2 phase 2, feature 1 — activity feed and undo *(removed; see the entry at the end)*

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

Verified: 53 backend tests (10 new) and 169 frontend tests (10 new), lint and
build green.

Docker Desktop's Linux engine stopped partway through this work and the backend
tests were briefly unrunnable — the fix was `wsl --shutdown` followed by
restarting Docker Desktop, which is worth knowing the next time `tangram-pg`
refuses to start with a 500 from the engine API.

## v2 phase 2, feature 3 — card depth (due dates and assignees)

Scoped deliberately. The roadmap listed labels, due dates, assignees and
comments; this delivers **due dates and assignees**, which are two columns on
`Card` and flow through the existing update path. Labels and comments each need
their own table and lifecycle and are recorded below as not started.

- **A due date is a day, not a moment.** Stored as UTC midnight and read back in
  UTC everywhere. Keeping the submitted time would let two people in different
  zones disagree about whether the same card is overdue -- and reading it back
  through the local timezone is how a card starts claiming it was due yesterday.
- **One request shape for every field-level edit.** Splitting due date and
  assignee into their own endpoints would mean three operations, and three
  inverses, for what a user experiences as one edit in one panel.
- **Clearing needs its own flag.** JSON cannot distinguish "absent" from "null"
  on a plain property, so `clearDueAt` / `clearAssignee` carry the difference.
  Without them every partial edit would wipe the fields it did not mention. The
  client's optimistic update mirrors the rule exactly, or the optimistic view
  would disagree with the broadcast that follows it.
- **Still emitted as `card.rename`.** The operations log holds historical
  `card.rename` rows that resync replays, so a new op type would mean every
  client understanding both forever. The payload was always a whole card.
- **The inverse now restores the whole card.** Undoing an edit that set a due
  date has to clear it again, and restoring a deleted card has to bring its due
  date and assignee back with it.
- **`AssigneeId` has no foreign key, on purpose.** Memberships change, and a
  removed member must neither block their own removal nor cascade-delete the
  cards they were assigned. Assigning someone outside the workspace is refused
  outright -- storing it would put a name on the card that nobody there can
  resolve.
- **An assignee who has left stays visible in the picker.** They are absent from
  `members`, so a plain select would fall back to "Unassigned" and the next save
  would silently clear the assignment. A placeholder option makes the state
  visible instead.
- **The roster fetch is non-fatal.** Without it the picker has no options and
  cards show no avatar; nothing else on the board depends on it, so failing the
  whole surface over it would be worse.
- **Due status is said, not only coloured.** "2d late" reads the same to
  everyone, including anyone who cannot tell the danger token from the warning
  one.

### Not started: labels and comments

Both need a new table and their own operation types on the sync spine, each with
an inverse. Comments additionally raise questions this codebase has not had to
answer yet -- whether a comment is undoable, whether editing one is, and what
happens to comments when their card is deleted and later restored. Left
unstarted rather than half-built.

## v2 — two defects found by manual browser testing

Both were invisible to the automated suites and only showed up when the app was
driven as a person drives it.

**The read-only card panel was inconsistent with itself.** Title and Description
degraded to plain text for a viewer, but Due and Assignee stayed as a *disabled*
date picker and dropdown — editable-looking chrome nobody could use, and an
empty `dd-mm-yyyy` field offered for data that wasn't there. S8.1 says remove
for a role and disable only for a transient state; a viewer's inability is
permanent for the session. All four fields now degrade the same way. The tests
missed it because they asserted `readOnly` on the title and never looked at how
the other two rendered.

**An undo was unreadable in the activity feed.** Undoing a card creation
appended a plain `card.delete`, which the feed rendered as *"deleted a card"* —
not identifiable as an undo, and missing the card's name, because a delete takes
its name from an inverse and undos deliberately record none. Operations now
carry `UndoOfSeq`, the seq they reversed, and the feed describes them in the
gerund: *"undid adding “Live sync probe”"*.

- **The phrasing is a separate function, not `"undid " + Summarize(...)`.** That
  concatenation produces "undid added “X”".
- **The target is loaded separately, not read from the page already fetched.**
  Undoing something from last week puts the target far outside the window, where
  it would degrade to "undid an earlier change".
- **A column restore collapses to one line.** It appends the column and every
  card it held, all sharing one `UndoOfSeq`; that is one action to a person, and
  without the collapse a single undo fills the feed.
- **Operations written before this keep their old rendering.** The column is
  nullable and old rows have no value, so they fall back to the ordinary
  summary — visible in local dev as older rows still reading "deleted a card".

## v2 — the first-run experience, corrected

Two problems surfaced when a real person signed up rather than a test fixture.

**The introduction never played for a new account.** Seen-state was keyed per
browser (`tangram-seen:board-intro`), so the second person to sign up in the
same browser got nothing. The original note argued a per-account field wasn't
worth a migration and an endpoint — which was true, and beside the point: the
key just needed the user's id in it. It is now `board-intro:{uid}`, still
localStorage, still no server change. This project is demonstrated by signing up
fresh accounts in one browser, which is precisely the case that was broken.

**The three starter columns were undoable, and undoing them was a dead end.**
The bootstrap created them with three ordinary API calls carrying the user's
token, so the log recorded them as work that user did. Two consequences: the
activity feed opened by claiming someone added columns they had never touched,
and undo offered to reverse them. Since an undo carries no inverse — deliberately,
to stop undo becoming redo — three curious presses of Ctrl+Z stripped a
brand-new board to nothing with no way back. A new user's very first interaction
could destroy their board irreversibly.

The fix is not to make undo cleverer. Undo behaved correctly on the operations it
was given; the defect was recording scaffolding as user work. Seeding now happens
server-side inside the board-create transaction, writing no `operations` rows.

- **Nothing to undo, nothing to misattribute.** A fresh board's feed is genuinely
  empty, matching the empty state that was already written for it.
- **Board `seq` stays 0.** Scaffolding is not an operation, so it must not
  advance the sequence clients reconcile against. No broadcast is lost either —
  nobody can be connected to a board that did not exist a moment ago.
- **Four round trips became one**, removing a window where a board could exist
  with one column of three if any call failed.
- **Only the bootstrap seeds.** A board created deliberately stays empty: its
  empty state already names the next action, and someone who chose to make a
  board may want a different shape of work. One flag on the request keeps both
  behaviours intentional rather than accidental.

Verified end to end in a browser, in the reported scenario: a fresh sign-up
landed on a seeded three-column board with zero operations and `seq` 0, and the
introduction played — while the old global seen-flag was still set in that same
browser, which is what proves the per-user key is the one being read.

## v2 — the welcome flow

A single screen between signing up and having a board, at `/welcome`. The
bootstrap used to manufacture a workspace and a board silently; now it hands
over to a screen that asks.

**Why one screen and not a wizard.** NN/g's position is that onboarding a person
must get through before reaching the product reduces usability and should be
avoided where possible — even skipping costs an interaction — and that tutorials
do not improve task performance. Their carve-out is the case that applies here:
onboarding earns its place when you genuinely need information to get started.
Trello, the closest analogue, does not gate a new account either; you land on a
board and templates are opt-in.

So: everything pre-filled, nothing mandatory, skip always visible. Pressing
Enter immediately produces exactly what the old automatic bootstrap produced.

**What it buys, given that constraint:**

- **Names somebody chose.** Every account previously got "My Workspace" and
  "My Board" — placeholders. The workspace name is suggested from the display
  name ("Ada's workspace"), which reads like a real place.
- **A board shape that matches the work**, offered as templates showing the
  columns they produce rather than a free-form "name your columns" field.
  Someone who has not seen the product cannot design their own workflow, and
  asking them to is exactly the mandatory step that turns setup into an
  obstacle.
- **The invite prompt at the moment of highest intent.** Collaboration is the
  whole point of this app and was previously invisible until you went looking
  for the members page.

**Decisions inside it:**

- **Template columns are scaffolding, like the seeded three** — written in the
  board-create transaction with no operations rows, so a new user still cannot
  undo their way to an empty board.
- **A bad address warns, it does not block.** Invalid entries are named and
  skipped; invites are attempted individually and never rethrow, because one
  bad address must not cost someone the board they just made.
- **Double submit is latched.** A second run would create a second workspace,
  which is the mess the bootstrap was rewritten to avoid.
- **Anyone who already has a board is redirected away.** An invited teammate has
  nothing to set up.
- **The workspace name field is hidden when it would be ignored.** Someone can
  arrive owning an empty workspace; the board goes there rather than stacking a
  second one, so the screen states which workspace instead of offering a name
  field that silently does nothing. Found by using the flow rather than by
  reading it.

Verified in a browser end to end: a real sign-up reached `/welcome`, the Sprint
template produced Backlog/In Progress/Review/Done in rank order with `seq` 0 and
zero operations, the valid invite was written and the invalid one skipped, and
Skip produced a Basic board and landed on it.

## v2 — accepting and declining invitations

There was no accept step. An invitation to an unregistered address was claimed
by `CurrentUserLoader` on that person's first authenticated request, by matching
the token's email claim against pending invitations.

**That was a vulnerability, not just a missing screen.** Nothing in this stack
verifies an email address — Firebase issues tokens for password sign-ups with
`email_verified: false`, and the API never read that flag — so anyone who knew an
invited address could create an account with it and be handed the workspace. The
real invitee then found their invitation gone. Being silently added is the mild
version of the same problem: joining a tenant puts your name and address in front
of its owners, which should be a decision.

**Shape, following GitHub's:** a 256-bit token on the invitation, a seven-day
expiry (GitHub's number), single use, and `GET /invitations/{token}` +
`/accept` + `/decline`. `ClaimPendingInvitationsAsync` is deleted rather than
guarded — a fallback that grants membership by email is the whole bug.

**Decisions inside it:**

- **Anyone holding the link can accept.** Binding acceptance to the invited
  address would be theatre: the address is unverified, so matching it proves
  nothing that the token doesn't already prove better. It also breaks the common
  case of someone whose real address differs from the one a colleague guessed.
  The link is therefore a credential, and the copy an owner pastes says so.
- **The offer is readable signed out.** Deciding whether to create an account is
  impossible if you cannot see what it would be for. It carries the workspace
  name, the role, who invited you, and the address it was sent to — and nothing
  about the board.
- **Re-inviting mints a fresh token.** The previous link may be sitting in a
  channel the owner no longer wants it in; re-inviting is their only control
  over that. Revoking kills it outright.
- **The token is owner-only.** `GET /members` nulls it for everyone else. A
  viewer who could read it could hand out membership — precisely the authority
  the role withholds. Found by writing the test for it.
- **Declining is recorded, not deleted.** The row is the owner's audit trail,
  and without a marker the invitation would simply be offered again.
- **`?next=` survives the sign-up round trip**, validated against open redirect:
  same-origin paths only, rejecting `//host`, `https://host` and the `/\host`
  form browsers normalise.
- **Existing invitations were not grandfathered.** The migration backfills a
  random token per row before creating the unique index. Those tokens have never
  been sent anywhere, so every pre-existing invitation is inert until an owner
  copies its fresh link.

**Open, and deliberately not decided here:** inviting an address that *already*
has an account still adds them immediately, with no accept step. Since declining
requires signing in — which creates the account — a decline can be overridden by
the owner clicking Invite again. `Re_inviting_someone_who_declined_adds_them_
without_asking_again` documents it rather than asserting it is right. Closing it
means every invite goes through a link, including for existing users, and there
is no in-app alternative: listing someone's pending invitations by their
unverified email would reintroduce the original vulnerability. That is a product
decision.

Verified by new integration tests plus component tests, and by rewriting the two
tests that encoded the old behaviour to assert its opposite. Thirteen other tests
turned out to depend on auto-claim by accident — they invited a user whose row
did not exist yet — and now register that user first, via a named factory helper
that says why.

### The flow, revised

The first build put an offer screen in front of everybody. Reviewing it turned up
a screen that, for a signed-out visitor, existed to render a button meaning
*continue*: they cannot join until there is an account to join as, so Accept was
not a real choice there. Three arrivals, three behaviours:

| Who | What happens |
|---|---|
| No account | Straight to sign-up, invitation shown as a banner; accepted on return; lands on the board |
| Signed in, opened the link | Asked, and told which account would join |
| Signed in, back from sign-up (`?accept=1`) | Accepted without asking again |

- **Acceptance is a POST the page makes, never the navigation.** Slack, Outlook
  Safe Links and corporate mail scanners fetch URLs to build previews; a GET that
  joins would be spent before the human clicked. This is why "opening the link
  accepts" is safe to say at all.
- **Declining needs no account** and is anonymous on the server. Requiring
  someone to register before they can refuse is the opposite of the point, and
  the token already carries that authority — anyone who could reach the endpoint
  could have taken the membership instead. Accepting stays authorized: refusing
  spends the holder's own opportunity, joining puts a person into a tenant.
- **Only sign-up auto-accepts.** `/login?invite=` is also the "use a different
  account" route, and someone switching accounts *before* deciding must not find
  they joined on the one they switched to.
- **The banner replaced the screen, not the explanation.** Dropping a stranger
  onto a bare sign-up form removes the reason they are filling it in. Same words,
  no extra page.
- **The address is never in a URL.** It comes back on the offer response and
  prefills sign-up from there, so it stays out of browser history, Referer
  headers and access logs. Rejected the original `?email=` parameter for that.
- **Bad link exits by auth state** — signed in to the boards, signed out to sign
  in. `/board` would bounce a signed-out visitor to `/login` anyway, one flash of
  the wrong page later.

Driven in a browser for everything that needs no password: a real pending
invitation redirected to sign-up with the address prefilled from the API and
absent from the URL, the banner named the workspace, role and inviter, Decline
worked with no account and left `declined_at` set, the invite page then read the
status back as turned down, and an unknown token exited to sign in.

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


## v2 — removing the activity feed and undo

Both were built, shipped, manually tested, and then removed on the product
owner's call: the feed was not what they wanted the board to be. Recorded here
because a feature that existed and stopped existing is a decision, and because
what it leaves behind is not obvious.

**What went.** The activity panel and its header button, `GET /boards/{id}/activity`,
`POST /boards/{id}/undo`, the Ctrl+Z handler, `BuildUndoAsync` and both summary
functions, the `ActivityEntry` / `ActivityResponse` / `ColumnSnapshot` DTOs, and
four columns on `operations`: `inverse_op_type`, `inverse_payload`, `undone_at`,
`undo_of_seq`. The `(board_id, actor_id, seq)` index went with them — it existed
to answer "the newest thing this person did that is still undoable", and nothing
asks that any more.

**What stayed, and why.** The `operations` table itself. Resync reads it: a
client that reconnects asks for everything after the seq it last saw and replays
it, which is what makes the reconnect banner recover rather than reload. It is
now the table's only reader.

**What this costs, stated plainly.** Deleting a column or a card is final. It was
recoverable while undo existed — `column.delete` snapshotted its cards precisely
so a restore would not bring back an empty column. Those snapshots are gone, so
the confirmation dialogs are now the only thing between a person and the loss,
which is why they still name the consequence and the card (S4.2).

**The migration is one-way for the data**, not just the schema. `Down` re-adds
the four columns, but they come back empty and cannot be backfilled: an inverse
records the state an operation *replaced*, and the payload only ever recorded
what it produced. Restoring undo later means it works from that point forward
and never over history.

**Two tests were rewritten rather than deleted**, because their subject survived
the feature that motivated them. `Seeded_columns_are_not_recorded_as_work_the_user_did`
now queries the operations table directly instead of the feed — seeding must
still leave no rows, because resync replays them and a reconnecting client must
not be told to add three columns that were there from the start. The due-date
test now asserts that a field-only edit still appends an operation, which is what
keeps a reconnecting client in agreement with the server.

Two more were replaced outright: `Undoing_an_edit_restores_the_whole_card` became
`One_edit_applies_every_field_it_names`, and both restore tests became
`Deleting_a_card_is_final` and `Deleting_a_column_takes_its_cards_and_is_final` —
pinning the new behaviour rather than the old one.

## v3 — the card as a ticket (phases 0–3)

v3's whole premise is that the machine worked and nothing looked like a product,
so every component here was researched against Atlassian's own documentation
before it was built. Several decisions are places where Jira's answer was
examined and **rejected**, which is the useful half of the record.

- **A modal over a dimmed board, not a drawer and not a page.** The 420px drawer
  could not hold two columns and a comment thread. A route change would have
  meant moving the board into a layout to keep it mounted behind, and buys
  nothing the query parameter does not: `?card=` matches what Jira does with
  `?selectedIssue=`, so a card is linkable without leaving the board, Back
  closes it, and a refresh reopens it. Navigating away would also throw the
  board out, and on a kanban tool the surrounding columns *are* half the context.
- **Description fields left, context fields right**, which is Jira's split: what
  the work *is* against what you sort and filter by.
- **Every field saves itself.** One Save button had made four fields share one
  request's fate, and `runMutation` swallowed the failure and closed the panel
  anyway — a rejected save was indistinguishable from a successful one. Per-field
  saving needed each field to own its failure surface, which is the only reason
  it is more code than a form.
- **The panel used to hold a snapshot**, so someone else's edit to the open card
  never appeared in it. Deriving the open card from the URL and looking it up in
  board state fixed a live sync defect as a side effect of the layout change.
- **Priority defaults to None, not Jira's Medium.** A priority on every card is a
  priority on nothing. One nullable enum, no new operation type, no reducer case
  — it flows through the existing update path exactly as due date did.
- **Labels ride the card update rather than getting their own operations.** The
  plan called for `card.label.add` / `card.label.remove`; the set a card carries
  is a field of the card, and giving it two operation types would mean two more
  inverses and two more reducer cases to describe one edit. Labels are
  board-scoped, and the colours are data, so they take the documented hex
  exception the avatar palette already has.
- **Comments are fetched per card, not with the board.** Labels are bounded and
  travel with the card; a thread is not, and putting it in the board payload
  would make every board load pay for every conversation on it.
- **A comment is not the activity feed that was removed.** That distinction was
  flagged when comments were scoped and it holds: the removed feed was *derived
  history*, machine-written from the operations log. A comment is authored. If a
  "History" tab ever appears beside it, that is the old feature returning through
  a side door.
- **Enter is a newline; Ctrl/⌘+Enter sends.** A comment is prose often worth two
  paragraphs, and a composer that submits on Enter costs the second one.
- **Editing is marked, deleting confirms.** Both are the ordinary rules —
  S4.2 says a confirmation names the consequence — but the edit marker also
  matters for trust: an unmarked edit means a quoted comment can be silently
  rewritten underneath the reply.

## v3 — the board (phases 0–2)

- **Columns became lanes with one menu.** The delete control had been
  hover-only, which is invisible on touch and to anyone who does not think to
  hover. Every column now carries the same `⋯` in the same place. `Menu` was
  extracted at the third copy of it, not the second.
- **Filter state lives in the URL.** A filtered board is a thing people send each
  other; keeping it in React state would make that impossible and a refresh
  destructive. It also means Back leaves the board rather than unwinding a filter
  one keystroke at a time, which is the correct trade — the alternative traps
  someone who typed six characters into pressing Back six times.
- **No "Only My Work items" quick filter, which Jira ships.** Your own row is
  first in the People menu instead. Two controls holding the same state disagree
  the moment somebody uses both.
- **Dragging stays enabled while filtered.** The instinct was to disable it, on
  the assumption that dropping between two visible cards would rank against the
  wrong neighbours. Reading `MoveCardAsync` showed the server ranks against the
  true database neighbours regardless of what the client can see, so the
  assumption was wrong and the restriction would have been pure loss.
- **Work-in-progress limits are advisory and never enforced.** Atlassian
  specifies red over and amber under, and both are signals. Blocking a move into
  a full column strands the work in the stage before it, which is the opposite of
  what a limit is for.
- **Min-versus-max validation lives in the service, not the controller.** Setting
  only a minimum has to be checked against the maximum already stored, which the
  controller cannot see. The first version validated what the request contained
  and accepted a minimum above an existing maximum; a test caught it.

## v3 — creating things, and the settings panel

- **One create dialog, not a button per column.** Jira has one create control,
  and the per-column buttons were adding a row of chrome to every lane to save
  one field. The dialog preselects the column you would have clicked in.
- **The `c` shortcut yields to text.** It is a letter someone is about to type,
  so it is ignored whenever an editable element has focus.
- **Creating a card that the active filter would hide warns while you type**, and
  offers to clear the filter rather than doing it. Creating something that
  vanishes on submit reads as a failure.
- **Seeding an empty board is one request for N columns.** A loop of creates that
  fails halfway leaves a half-built workflow and no clear state to resume from;
  one `SaveAsync` with N pending operations either builds the workflow or does
  not.
- **The settings panel finally gave column reordering a UI.** The endpoint and
  the broadcast both shipped in v1 with nothing on the frontend calling them —
  found while looking for somewhere to put the limits.

## v3 — navigation moved to a sidebar

- **One `GET /workspaces` gives the whole tree**, so the sidebar does not fan out
  a request per workspace to find its boards.
- **The workspace is derived from the open board** when the route only knows a
  board id, rather than being stored separately and risking the two disagreeing.
- **A failed sidebar load is swallowed deliberately.** Navigation is not the page;
  degrading to no sidebar is better than failing the board over it — the same
  reasoning as the assignee roster fetch in v2.
- **Collapsed state is `localStorage` through `useSyncExternalStore`**, so two
  tabs agree rather than drifting apart.

## v3 — ranks were being compared with the wrong collation

The most serious defect the project has had, and it predates v3 entirely. It
surfaced as a 500 on `/move` (`ArgumentException: lower must sort before upper`)
and was found to also explain duplicate ranks on append and boards drawing in an
order the server had not computed.

`RankService` builds keys from `0-9A-Za-z` and compares them with
`string.CompareOrdinal`. Postgres was ordering the same strings under `en_US`,
which ignores case and punctuation differences that the alphabet depends on — so
`ORDER BY rank` returned neighbours that the service then rejected as
out of order. Two components agreed on the alphabet and disagreed on the
comparison.

- **Both rank columns are `COLLATE "C"`.** Ordinal comparison in the database,
  matching the code. Anything else means the ordering is only accidentally
  correct.
- **The migration renumbers every existing rank**, partitioned per board and per
  column, into evenly spaced three-character keys that preserve the order as
  displayed. Re-collating alone would have reordered live boards.
- **The regression test was proved to fail without the fix** by altering the test
  database's collation back and watching it break. A test that has never failed
  is a claim, not evidence.

## v3 — contrast is a test, not a habit

Introducing six palettes exposed two faults that a single palette had hidden.

- **Surfaces were 0.7–2.4 L\* apart in every palette**, so the lanes — the thing
  that makes a kanban board legible — were invisible against the board behind
  them. Found by eye on one palette, then measured and found in all six.
- **CIE L\*, not WCAG contrast ratio, for surfaces.** The ratio is built for text
  and is nearly flat at that end of the scale: every failing pair scored between
  1.02 and 1.06, which does not distinguish "invisible" from "subtle". The ratio
  is still the right measure for text on the accent, which is what it is for.
- **White was hardcoded on the accent** in the auth panel. Safe with one palette;
  once they were switchable, Graphite's dark accent is `#ededed` and white
  measured 1.17:1 against it. Every dark palette failed between 1.17 and 3.45.
- Both are now `globals.contrast.test.ts`, and the rules they encode are
  S1.2a–S1.2c in [`ui-standards.md`](ui-standards.md).

## v3 — themes live in the browser, not the account

Six palettes, each with a full light and dark token set, chosen from the account
menu and stored in `localStorage` under `tangram-theme`. No column, no endpoint,
no sync.

**A database preference could not replace this, only sit on top of it.** The
theme has to be on `<html>` before anything renders, which is why a blocking
script runs in `<head>` — a stored preference read after authentication and a
round trip would paint the default first and flash to the person's actual theme
on every load. Avoiding that means caching it in `localStorage` regardless, so
the column would be a sync layer over the same mechanism rather than an
alternative to it. Cross-device theme sync is a lot of moving parts to
demonstrate something the local version already demonstrates.

What it costs: the choice is per-device, and it does not survive clearing site
data. Both were accepted.

**Every stored value is validated against the palettes that exist**, in the
blocking script and again in the provider. This is not defensive habit — the
tokens are defined only inside `[data-theme="…"][data-mode="…"]` blocks, so a
name matching no block leaves `--bg`, `--text` and `--accent` all undefined and
the app renders unpainted until site data is cleared. It is unreachable while the
palette list is stable and reachable the moment one is renamed or removed, which
is the likely outcome of using these to choose a final palette. The same fallback
runs from the script's `catch`, because private browsing throws on read and
leaving the attributes unset reaches the identical failure.

## v4 — the database was on the wrong continent

A card took 3.1 seconds to move on the deployed app and 4 milliseconds locally.
Nothing in the codebase, the tests or the logs could say why, and three
explanations fit the same number while needing opposite fixes: twelve round
trips over a slow link, one slow query, or a starved CPU.

- **Instrumentation first, and it decided everything after it.** Every response
  carries `Server-Timing` with the database time, the round-trip count, the
  slowest single trip, connection-open time, broadcast time and the residual.
  On in production deliberately: locally the database answers in under a
  millisecond, so a profiler here shows a request path that looks healthy and is
  three seconds slower once deployed.
- **The slowest-trip figure is what discriminates.** Twelve trips totalling 2.1s
  with a slowest of 175ms is a flat distribution — every statement costs the same
  regardless of what it asks for, which is a wire rather than a query plan. The
  same total with a slowest of 2.0s would have been a missing index. Without that
  one extra number the two are indistinguishable.
- **`/health/db` prices a single round trip.** `/health` costs a request and no
  database; the probe costs a request and exactly one `SELECT 1`. Subtracting one
  header from the other gives the cost of one round trip on the deployment being
  asked about — 216ms, which no local measurement could have produced. Anonymous,
  because an authenticated probe can only be run by someone holding a token,
  which excludes every tool that would otherwise watch it.
- **Neon was in Singapore and Render in Ohio.** Nothing in the code implied it and
  nothing could have. Moving the database to `us-east-2` took an environment
  variable and a 32MB dump/restore, and took one round trip from 216ms to 14.8ms
  — the move from 4222ms to 128ms is almost entirely this.
- **The database moved, not the API.** Neither host can change a region in place,
  so both meant recreate-and-repoint; moving the database keeps the API's URL and
  therefore leaves CORS, Firebase and the frontend's build-time API URL alone.
  Moving Render to Singapore would have been faster still for a user in India and
  slower for everyone else, at several times the work.
- **The restore needed two things verified that a row count would not catch.**
  Both `rank` columns had to come back `COLLATE "C"` or every ordering would
  silently disagree with `RankService` again; and the new database's `search_path`
  was empty, which breaks EF Core because it emits unqualified table names. The
  connection string now carries `Search Path=public` so the app does not depend on
  server-side state that was observably wrong once.
- **A census of all 31 endpoints, not the one that was noticed.** The costliest
  problem was in machinery every endpoint shared: two round trips per request in
  the user loader, and two more per mutation re-establishing an authorization
  answer the request already held. Optimising the move alone would have missed it.
- **Roles are answered from per-request memory, which is not a cache.** The loader
  reads memberships to build the tenant filter; the role is a column on those same
  rows. `ICurrentUserService` is scoped to the request and dies with it, so scope
  and role are still re-derived per request and per hub call — the invariant that
  stops a removed member acting on a long-lived connection.
- **Budgets count round trips, never time.** A timing assertion measures the
  machine running it. Round trips are a property of the code and identical
  everywhere; the price of one is a property of the deployment.
- **The transaction was left alone.** Four of a mutation's six or seven trips are
  `SaveAsync` — BEGIN, the seq `UPDATE … RETURNING`, `SaveChanges`, COMMIT.
  Collapsing them into one hand-written CTE would save ~25ms and trade away the
  guarantee every operation depends on.
- **One hypothesis was killed by measuring it.** The broadcast is awaited on the
  request path, and a client slow to accept it would delay the response to the
  person who caused the change — a good theory with a plausible mechanism, and
  `push;dur=4.1` ended it. An hour of making writes fire-and-forget was avoided by
  adding one metric.
- **The cold path stays.** Neon suspends compute after 5 minutes idle, so the
  first request after a pause pays ~1200ms across four fresh connections. A
  keep-alive would hold compute continuously — ~730 hours a month against a free
  tier granting ~192. The scale-to-zero is what makes the rest free, so this is
  accepted rather than fixed.

The rules this produced are [`performance-standards.md`](performance-standards.md).
