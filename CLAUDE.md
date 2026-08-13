# Tangram — working notes for coding agents

Multi-tenant real-time collaborative kanban. ASP.NET Core 10 + SignalR + EF Core,
Next.js 16 + React 19 + Tailwind v4, PostgreSQL, Firebase Auth.

Live: <https://tangram-mu.vercel.app> · API <https://tangram-hk8a.onrender.com>

**This file holds rules and gotchas — things that are easy to get wrong.** History and
rationale live elsewhere and should not be duplicated here:

- [`docs/decisions.md`](docs/decisions.md) — why each decision was made, per slice
- [`docs/roadmap-v2.md`](docs/roadmap-v2.md) — what v2 is, in two phases
- [`docs/roadmap-v3.md`](docs/roadmap-v3.md) — v3: the interface reworked around Jira's
  shape, what it deliberately skipped, and what it found already broken
- [`docs/roadmap-v4.md`](docs/roadmap-v4.md) — v4: why a card took three seconds to move,
  what the fix actually was, and the hypotheses that were wrong
- [`docs/manual-test.md`](docs/manual-test.md) — the by-hand pass for the current app
- [`docs/performance-standards.md`](docs/performance-standards.md) — how latency is
  measured here and what a new endpoint must cost
- [`README.md`](README.md) — architecture, setup, deployment, known gaps
- `git log` — commit messages are written as decision records; search them first

## The UI gate

**Anything user-facing must satisfy [`docs/ui-standards.md`](docs/ui-standards.md).** Read
it before writing UI, and in the change say which rules it engages and how each is met —
e.g. *"meets S2.1 (four states), S3.2 (error names the next action), S4.2 (consequence in
the confirm)"*.

The rules exist because each was learned the hard way here. The ones most often violated by
plausible-looking code: **S1.3** (`cn()` has no Tailwind conflict resolution), **S3.1** (no
infrastructure in error copy), **S3.6** (silent catches), and **S8.1** (remove for a role,
disable for a transient state).

Two rules are lint-enforced — native dialogs and raw hex — so a violation fails CI rather
than review.

## The performance gate

**Any new endpoint must satisfy [`docs/performance-standards.md`](docs/performance-standards.md),
and `EndpointCensusTests` enforces the part that can be.** Add the endpoint to the census with
its measured round-trip count; the budget is the actual number, not a generous ceiling, so any
later addition fails on the machine that made it.

The rules most often broken by plausible-looking code: **P3.1** (asking the database something
the request already holds), **P3.3** (a permission check that costs its own query instead of
riding the entity load), and **P1.1** (concluding from a total with no breakdown).

Every response carries `Server-Timing` — `db` with the round-trip count and the slowest single
trip, plus `conn`, `push`, `app` and `total`. It is on in production because that is the only
place the interesting latency exists: locally the database answers in under a millisecond.

## Invariants — violating these breaks correctness

**Every board mutation goes through `BoardOperationService.SaveAsync`.**
It assigns the next per-board `seq` per operation in one atomic `UPDATE … RETURNING`,
persists, appends to the `operations` log, then broadcasts — after the commit, never
inside it. Conflicts resolve by server `seq`, never wall-clock time. Adding a mutation
path that skips it silently breaks sync.

**Nothing reads the `operations` log except resync.** A reconnecting client asks for
everything after the seq it last saw and replays it. There was an activity feed and an
undo; both were removed, along with the inverse payloads and undo markers only they read.

Before adding either back: **an inverse cannot be reconstructed after the fact.** The
payload records the state an operation *produced*, never the one it replaced, so a rename
that didn't capture the old title before assigning the new one is permanently un-undoable,
and a `column.delete` that didn't snapshot its cards cannot restore them. Undo would work
from the point it was reintroduced, never over history.

**Deleting a column or a card is final.** It used to be recoverable, so the confirmations
must keep naming the consequence — they are now the only thing between a person and the
loss (S4.2).

**Writes are REST-only; the hub is broadcast-only.** `BoardHub` exposes no mutations.
One write path means one place enforcing authorization and assigning `seq`.

**Broadcast application must stay idempotent.** Resync replays operations the client may
already have applied, so `applyOperation` replaces state by id rather than appending.

**Tenant scope is re-derived per request and per hub call**, never cached on the
connection. EF global query filters read `ICurrentUserService.WorkspaceIds`, populated by
`CurrentUserLoader`, which also carries each workspace's **role** so an authorization check
is a dictionary lookup rather than a query. That is per-request state, not a cache: the
instance dies with the request, which is what stops a removed member acting on a
long-lived connection. Caching it across requests would break exactly that.

A non-member gets 404 from the filter before any role check runs — so "not found" and
"not permitted" are deliberately conflated. Mutations now load their entity before
checking the role, so a viewer naming something that doesn't exist gets 404 rather than
403; that leans the same way on purpose.

**An email address is not a credential.** Nothing here verifies one — Firebase treats a
password sign-up as unverified — so no code path may grant membership because the caller's
email matches something. `CurrentUserLoader` used to claim pending invitations exactly that
way, which made knowing an address enough to take someone else's invitation. Membership now
comes only from `POST /invitations/{token}/accept`, and the token is the secret.

**Emails are normalized through `EmailAddress.Normalize` on both sides.** The immediate-join
branch of `POST /members` is an exact index lookup on `Users.Email`; unnormalized input
silently falls through to "create an invitation" instead, and the owner is never told they
just invited someone who was already here.

**The invitation token is owner-only.** `GET /members` nulls it for everyone else — a viewer
who could read it could hand out membership, which is the authority the role withholds.

**Accepting is a POST the page makes, never a navigation.** Slack, Outlook Safe Links and
corporate mail scanners fetch URLs to build previews, so a GET that joins is spent before
the human clicks. Declining is a POST for the same reason — and is `[AllowAnonymous]`,
because requiring an account to refuse means creating one to say no. Accepting stays
`[Authorize]`: refusing costs the holder their own opportunity, joining puts someone into
a tenant.

**Only sign-up auto-accepts** (`/invite/{token}?accept=1`). Creating an account for an
invitation is unambiguous consent; being signed in when you open a link is not, and
`/login?invite=` is also how "use a different account" works — auto-accepting there would
join whichever account someone switched to. There is no "leave workspace" yet, so a wrong
join is not self-undoable.

**The invited address never travels in a URL.** It comes back on the offer response and
prefills sign-up from there. A query parameter would put it in browser history, Referer
headers and every access log the link passes through.

**Firebase is authoritative for display names, but a token without a `name` claim must
never overwrite a stored name** with the email-local-part fallback. That fallback is for
row creation only. Read both `"name"` and `ClaimTypes.Name` — JwtBearer's inbound map may
rewrite it.

**A workspace always keeps at least one owner.** Enforced server-side; the UI mirrors it
by disabling the control rather than letting the request 400.

**Ranks are fractional lexicographic strings.** Order by string comparison, never array
position. Inserting or moving writes exactly one row.

**And that comparison must be ordinal, in the database too.** `RankService` builds keys
from `0-9A-Za-z` and compares with `CompareOrdinal`, where every uppercase letter sorts
before every lowercase one. Postgres was ordering the same column under `en_US`, which
sorts case-insensitively, so `ORDER BY rank` disagreed with the code that generated those
ranks — moves picked the wrong neighbours and threw, appends collided on the same key, and
the board drew in one order while the server computed in another. Both rank columns are
`COLLATE "C"`; a new one must be too.

## Frontend traps

**`cn()` is a plain join with no Tailwind conflict resolution** ([`lib/cn.ts`](frontend/src/lib/cn.ts)).
Never append a second `border-*`/`px-*` and expect it to win — stylesheet order decides.
Either replace the class set wholesale or pick per-branch variants.

**The global focus ring in `globals.css` is unlayered**, so it outranks anything in
`@layer utilities` regardless of specificity — a `focus-visible:shadow-none` utility can
never override it. Composite fields opt out with `data-focus-ring="none"`.

**Variant utilities beat base ones**, so a shared `focus-within:border-accent` will hide a
`border-danger` error state exactly while the user is typing. Choose the focus colour per
branch.

**`NEXT_PUBLIC_*` values are inlined at build time.** Changing one needs a rebuild.

**No trailing slashes** on `NEXT_PUBLIC_API_BASE_URL` or `CORS__FRONTENDORIGIN`. A
trailing slash makes every request `//health` and 404s.

## Local development

```bash
docker start tangram-pg          # PostgreSQL 17 on 127.0.0.1:5433
cd backend/src/Tangram.Api && dotnet run --launch-profile http
cd frontend && npm run dev       # http://localhost:3000
```

Config lives in `appsettings.Local.json` (gitignored; template is
`appsettings.Local.json.example`) and `frontend/.env.local` (template `.env.example`).
Never commit either.

**If the API fails to bind with `WSAEACCES` while nothing is listening**, Windows has
reserved the port — Hyper-V/WSL claim dynamic ranges at boot, and 5286 has landed inside
one before. Check with `netsh interface ipv4 show excludedportrange protocol=tcp`, then
run on a free port (`dotnet run --no-launch-profile --urls http://localhost:5400`) and
point `NEXT_PUBLIC_API_BASE_URL` at it.

**Stopping the frontend needs the child PID.** Killing the npm wrapper leaves the Next
dev server holding port 3000, still running the old environment.

## Tests

```bash
cd backend && dotnet test    # 167 integration tests, needs tangram_test on :5433
cd frontend && npm test      # 661 Vitest tests, node by default
```

Backend tests are self-sufficient — a module initializer in `TestEnvironment.cs` seeds
`Firebase__ProjectId`, because `Program.cs` reads it before the host is built, earlier
than `WebApplicationFactory` can inject configuration. `TANGRAM_TEST_POSTGRES` overrides
the connection string; that is how CI points at its service container.

Frontend tests default to **node**, because most of what they cover is pure logic and jsdom
costs real startup time. Files that need a DOM opt in per file with
`// @vitest-environment jsdom` on the first line, and use Testing Library.

Two things bite in the DOM tests:

- **`afterEach(cleanup)` is mandatory.** Testing Library only auto-registers cleanup when
  Vitest globals are on, and they aren't here. Without it, an unmounted-in-name-only dialog
  keeps its `document` keydown listener and fights the next test for the Tab key.
- **The pool is `threads`, not the default `forks`.** Booting jsdom inside a forked child
  exceeded the worker startup timeout on Windows and the run died before any test executed.

## Deploying

`git push origin main`. That is the whole procedure.

| Branch | Moved by | Built by |
|---|---|---|
| `main` | you | nothing |
| `deploy` | CI, when green | Render, automatically |
| `release` | CI, once the backend is confirmed live | Vercel |

**Backend first**, because an API returning extra fields won't break an old frontend but a
frontend reading a field the deployed API doesn't send yet will. CI enforces the ordering
rather than trusting anyone to remember it: after promoting `deploy`, the `ship` job polls
`GET /health` until the `commit` it reports equals the SHA just promoted, and only then
advances `release`.

It then does the same for the frontend: `GET /api/health` on the Vercel deployment reports
`VERCEL_GIT_COMMIT_SHA`, and the job waits for that to match too. **Advancing a branch is
not a deploy, it is the trigger for one** — confirming only the backend would leave a green
pipeline, a correct branch pointer and a failed Vercel build with nothing to say so.

**That is why both `/health` endpoints report a commit**, instead of the job using a timer —
a timer is wrong in both directions, shipping early when it's short and dragging every
release when it's long. Both fields are pinned by tests (`HealthContractTests` and
`route.test.ts`), because removing one wouldn't fail loudly: the poll would simply never
match. The frontend route also sends `Cache-Control: no-store`, or the CDN could answer the
poll from the *previous* deployment and report success for a build that never went out.

Failure directions differ, and both are stated in the job's own error output. If Render
never serves the commit, `release` is left alone — safe. If Vercel never serves it, the
backend is already live and `release` has moved, so that is a Vercel build to go and look
at rather than something to re-run. `git ship` still exists as the manual fallback.

**Auto-Deploy on `deploy` is safe; on `main` it would not be.** The gate is the branch —
CI is what moves `deploy`, so a red build cannot reach production. Pointing Render at
`main` would delete the gate entirely.

**A migration that rewrites data applies unattended.** That is the one thing the old
manual click bought. `RankOrdinalCollation` renumbered every rank row in the database;
that class of change deserves a pause. Turn Auto-Deploy off before pushing one, deploy it
by hand, then turn it back on.

The hosts watch *different* branches on purpose — that is what makes ordering possible.
Never point either at `main`; the gate is the branch, so there is no deploy token.

Do not use Vercel's *Ignored Build Step* to make the frontend manual — "Don't build
anything" cancels manually created deployments too, leaving no way to deploy.

## Conventions

- **Comments explain why, not what.** Especially non-obvious constraints — a future reader
  should learn why the code resists an apparently simpler form.
- **Commit messages are decision records**: what changed, why, what was rejected, and how
  it was verified.
- **Verify claims before stating them.** Measure, run, or read the source. This project has
  a documented history of assertions that turned out wrong (see the platform research in
  `docs/decisions.md`).
- **Vendor documentation beats comparison sites** for any fact that decides a choice.
