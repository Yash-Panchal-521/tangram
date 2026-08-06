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
- **The deploy branch is the gate.** Render builds whatever lands on the branch
  it watches. Pointing it at `main` would have deployed on red and made CI
  decorative. So it watches `deploy`, and CI advances that branch only once both
  test jobs pass — the gate is the branch itself, and no deploy credential
  exists to leak. `--force-with-lease` so a hand-push to `deploy` fails loudly
  rather than being silently discarded.
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
