# Tangram

A multi-tenant, real-time collaborative kanban workspace. Multiple people edit the
same board live — drag cards, rename columns, watch each other's cursors — backed
by a server-authoritative sync pipeline (sequenced operations log, not last-write-wins
by clock time).

**Live: [tangram-mu.vercel.app](https://tangram-mu.vercel.app)** · API at
[tangram-hk8a.onrender.com](https://tangram-hk8a.onrender.com/health)

Sign up, create a board, then invite a second address and open it in another browser —
cards, columns, presence avatars and cursors all move in real time. The API sleeps
after 15 minutes idle on the free tier, so the first request after a quiet spell takes
30–60 seconds to wake; the client shows a reconnecting banner and recovers on its own.

## Status

All five slices are in, deployed, and verified in production with two real accounts —
presence, cursors, invites, RBAC and the read-only viewer UI all confirmed working end to
end.

Since then, **v2** added card depth and workspace management, and **v3** reworked the
interface around Jira's shape — see [`docs/roadmap-v2.md`](docs/roadmap-v2.md) and
[`docs/roadmap-v3.md`](docs/roadmap-v3.md). What v3 added, in one line each: the card
opens as a two-column ticket with priority, labels and comments; the board filters,
carries work-in-progress limits and has a settings panel; cards and columns are created
from dialogs rather than a control per column; navigation moved to a sidebar; and the
whole app has three switchable colour palettes.

**v4** was performance — see [`docs/roadmap-v4.md`](docs/roadmap-v4.md). A card took 3.1
seconds to move in production and 4 milliseconds locally. The cause was that the database
was in Singapore and the API in Ohio, which no amount of reading the code could reveal;
the fix was an environment variable, and it took a move from 4222ms to 128ms server-side.
Query folding across the whole backend was worth a further ~60ms. What remains is the
instrumentation that found it: every response carries `Server-Timing`, and the endpoint
census pins each measured endpoint to its exact round-trip count.

**v5** rebuilt the interface from a design export and then tested it by hand, screen by
screen, in a browser — which is how most of what it fixed was found. The card detail
became a right-hand drawer so the board stays visible beside it; the board grew swimlanes
grouping by assignee, priority or label; the workspace home shows each board's column
distribution and who is on it; and the chassis stopped being a tint of the accent, which
was the single loudest thing about the product. The findings and their fixes are in
[`docs/v5-bug-log.md`](docs/v5-bug-log.md).

| Slice | Scope | State |
|---|---|---|
| 1 | Walking skeleton — auth, tenant isolation, card create, seq/op-log/broadcast spine, design tokens | done |
| 2 | Drag-and-drop, full column/card CRUD, optimistic UI with rollback | done |
| 3 | Presence, live cursors, reconnect with delta resync | done |
| 4a | Workspace membership, email invites, sign-up, RBAC enforcement | done |
| 4b | Viewer read-only board UI | done |
| 5 | CI, then deploy | done — live on Render + Vercel + Neon |

## Architecture in brief

- **Frontend:** Next.js 16 (App Router, TypeScript, React 19, Tailwind v4). The board
  is a client component talking to the backend over REST + a SignalR WebSocket.
- **Backend:** ASP.NET Core Web API (.NET 10) + SignalR.
- **Database:** PostgreSQL 17 via EF Core, code-first migrations.
- **Auth:** Firebase Authentication issues ID tokens (email/password); the backend
  validates them as JWT bearer tokens against Firebase's issuer/public keys — the
  backend never sees a password and does no auth logic of its own.
- **Real-time sync spine (server-authoritative):** every mutation — eleven operation
  types across columns, cards and comments — runs the same pipeline: authorize → validate →
  assign the next per-board `seq` in a single atomic `UPDATE … RETURNING` → persist →
  append to the append-only `operations` log → broadcast `{seq, opType, payload}` to
  that board's SignalR group. Conflicts resolve by server `seq` order, never
  wall-clock time. All writes go through REST; the hub is broadcast-only.
- **Tenant isolation:** EF Core global query filters scope every query to the caller's
  workspace memberships, resolved fresh on every request *and* every hub call (never
  cached on the connection), so RBAC is enforced per-event rather than only at connect.
- **RBAC:** `Owner` / `Editor` / `Viewer` per workspace. Viewers read but cannot
  mutate; only owners manage members. A workspace always keeps at least one owner.
  The board reports the *caller's* role, so viewers get a genuinely read-only UI —
  edit controls are removed rather than shown and rejected — while still receiving
  presence, cursors and live updates.
- **Invitations:** inviting an address that already has an account creates the
  membership immediately; anything else writes a pending invitation carrying a
  256-bit token, and the owner passes the `/invite/{token}` link along. That link is
  the only thing that grants membership: the invitee opens it, sees what they'd be
  joining, and accepts or declines. Seven-day expiry, single use, re-issuing mints a
  fresh token so the old link dies. Tokens are returned to owners only.
- **Ordering:** columns and cards use fractional/lexicographic string ranks, so
  inserting or moving an item only ever writes one row.
- **Latency is measured, not assumed.** Every response carries a `Server-Timing` header
  splitting database time, connection time, broadcast time and the rest, with the
  round-trip count and the slowest single trip. `/health` and `/health/db` differ by
  exactly one `SELECT 1`, so subtracting their headers prices a single round trip on
  whatever deployment you point them at. Endpoint budgets are asserted in round trips
  rather than milliseconds — see [docs/performance-standards.md](docs/performance-standards.md).
- **Presence & resync:** in-memory presence tracker, connection-counted per user so
  two tabs don't flicker. On reconnect the client replays operations since its last
  seen `seq`; past a 200-operation gap the server tells it to refetch a snapshot.
- **Theming:** CSS custom-property design tokens (`--bg`, `--surface`, `--accent`, …)
  mapped into Tailwind's `@theme`, keyed by `[data-theme][data-mode]`. Three palettes ×
  light/dark, switchable at runtime from the account menu and stored per browser; a
  blocking script in `<head>` sets the attributes before first paint, so there is no
  flash of the wrong palette. No component reads a colour, so a fourth is a stylesheet
  block and a list entry. The chassis — grounds, surfaces and borders — is near-neutral
  and derived from each palette's accent hue at low chroma, so colour is spent on the
  accent rather than on the chrome. Surface separation, accent/text pairs and a chroma
  ceiling per chassis token are all asserted in `globals.contrast.test.ts` rather than
  left to judgement.

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) 20+ and npm
- PostgreSQL 16+ — either [Docker](https://www.docker.com/) or a
  [native install](https://www.postgresql.org/download/)
- A [Firebase](https://console.firebase.google.com/) project with the **Email/Password**
  sign-in provider enabled

## Database

Docker keeps the dev database isolated from anything already on your machine. Port
**5433** is used because a native PostgreSQL install typically holds 5432:

```bash
docker run -d --name tangram-pg --restart unless-stopped -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=tangram_dev -p 127.0.0.1:5433:5432 -v tangram-pgdata:/var/lib/postgresql/data postgres:17
```

Bound to loopback only, so it isn't exposed to your network. Then create the test
database:

```bash
docker exec tangram-pg psql -U postgres -c "CREATE DATABASE tangram_test;"
```

Restart it after a reboot with `docker start tangram-pg`. A native PostgreSQL works
equally well — just point the connection string at your own host, port, and password.

## Backend setup

Copy the config template and fill in your values. `appsettings.Local.json` is
gitignored, unlike `appsettings.Development.json`, so real values can't be committed
by accident:

```bash
cp backend/src/Tangram.Api/appsettings.Local.json.example backend/src/Tangram.Api/appsettings.Local.json
```

| Key | Required | Notes |
|---|---|---|
| `ConnectionStrings:Postgres` | yes | `Host=127.0.0.1;Port=5433;Database=tangram_dev;Username=postgres;Password=postgres` for the Docker setup above |
| `Firebase:ProjectId` | yes — the app refuses to start without it | Firebase console → Project settings → General |
| `Cors:FrontendOrigin` | no, defaults to `http://localhost:3000` | |

Environment variables (`ConnectionStrings__Postgres`, `Firebase__ProjectId`) override
the file, so deployments don't need it at all.

Apply migrations and run:

```bash
cd backend/src/Tangram.Api && dotnet tool install --global dotnet-ef && dotnet ef database update && dotnet run --launch-profile http
```

The `http` launch profile listens on `http://localhost:5286`. If that fails to
bind with `WSAEACCES` while nothing is listening, Windows has reserved the port —
run `dotnet run --no-launch-profile --urls http://localhost:5400` instead, which
is the port the rest of the docs and the frontend's default assume. In
Development, Swagger UI is at `/swagger` and the OpenAPI document at
`/openapi/v1.json`.

### Running backend tests

168 integration tests spin the API up in-memory (`WebApplicationFactory`) against the
`tangram_test` database, with Firebase JWT validation swapped for a header-driven
test handler.

```bash
cd backend && dotnet test
```

No secrets or environment variables required. `Program.cs` reads `Firebase:ProjectId`
before the host is built — earlier than `WebApplicationFactory` can inject
configuration — so the test assembly seeds it from a module initializer
(`Infrastructure/TestEnvironment.cs`). The value is irrelevant: `TestAuthHandler`
replaces Firebase JWT validation outright.

The suite expects `tangram_test` at `127.0.0.1:5433` with `postgres`/`postgres`.
Override with `TANGRAM_TEST_POSTGRES` if your instance differs — that's how CI points
at its own service container.

Coverage: tenant scoping, the card-create spine, board operations and rank
convergence, presence/cursors/resync, and membership — instant vs pending invites,
case-insensitive address matching, owner-only enforcement, last-owner guards, and
viewers being blocked from mutating.

## Frontend setup

```bash
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

Fill `.env.local` with your Firebase web config (console → Project settings → General
→ Your apps → SDK setup and configuration). All seven values are `NEXT_PUBLIC_*` and
ship in the client bundle — that's expected for Firebase web config, which identifies
the project rather than authorizing anything.

Open `http://localhost:3000`.

### Running frontend tests

821 Vitest tests. They default to the **node** environment because most of what they
cover is pure logic; files needing a DOM opt in per file with
`// @vitest-environment jsdom` and use Testing Library. No Firebase config is required.

```bash
cd frontend && npm test
```

## Using it

1. **Sign up** at `/signup`, then name your workspace, pick a column template and
   optionally invite people on the `/welcome` screen. Everything there has a default;
   **Skip** produces a workspace, a board and three starter columns.
2. **Invite someone** — **Members** in the sidebar, enter one or more addresses, pick a
   role per person, send.
3. **Nothing emails them.** There is no mail delivery, so use **Copy invite** to get a
   ready-made message containing an `/invite/{token}` link, and send it yourself. That
   link is a credential — anyone who opens it can join — so send it directly rather
   than posting it somewhere public. It lasts seven days and works once.
4. **They accept.** Someone without an account goes straight to sign-up, which shows
   what they're joining, and lands on the board already a member. Someone already
   signed in is asked first, and told which account would join. Either way they can
   decline — which needs no account, because making one to say no is absurd.
5. **Watch it sync.** With both of you on the board, cards, columns, presence avatars
   and cursors update live. Change someone to Viewer and their next edit is rejected.

To see real-time behaviour solo, open the same board URL in two tabs — cards and columns
sync between them. Presence and cursors will not appear, deliberately: both are counted
per *person*, not per connection, so your own second tab is still you.

**On the board:** **Create** (or press <kbd>c</kbd>) opens one dialog for a new card;
<kbd>/</kbd> focuses search. Filters by person, label, priority and due window live in
the URL, so a filtered board is a link you can send. **Group by** turns the columns into
a matrix, one row per assignee, priority or label, and a card can be dragged between rows
to reassign or reprioritise it. Clicking a card opens a right-hand drawer — fields, then
description, then comments — leaving the board visible beside it, and linkable via
`?card=`. Columns carry optional work-in-progress limits, which colour the lane without
ever blocking a move. The account menu switches between three colour palettes in light
or dark.

### Routes

| Route | Purpose |
|---|---|
| `/login`, `/signup` | Firebase email/password auth; `?next=` returns you mid-flow, `?invite=` shows the invitation |
| `/welcome` | First-run setup — workspace name, column template, invites |
| `/invite/[token]` | Accept or decline an invitation; `?accept=1` on the way back from sign-up |
| `/board` | Resolves which board to open from your memberships |
| `/boards` | Every workspace and board you belong to |
| `/board/[boardId]` | The collaborative board; `?card=` opens a ticket, filter state rides the query string |
| `/workspace/[workspaceId]/members` | Roster, invites, role management |
| `/kitchen-sink` | Design-system component gallery |

## Project structure

```
/frontend      Next.js app (App Router, TS, Tailwind)
/backend
  /src/Tangram.Api         ASP.NET Core Web API + SignalR + EF Core
  /tests/Tangram.Api.Tests xUnit integration tests
/docs          architecture/decision notes, growing per slice
```

## Deployment

Free tier throughout, and **no credit card anywhere** — which turned out to be the
binding constraint rather than price.

| Layer | Platform | Free tier |
|---|---|---|
| Frontend | [Vercel](https://tangram-mu.vercel.app) Hobby | non-commercial use only |
| Backend | [Render](https://tangram-hk8a.onrender.com/health) | 750 hours/month, sleeps after 15 min idle |
| Database | Neon | 0.5 GB, 100 compute-hours/month |
| Auth | Firebase Spark | same project as local |

Finding a host took four attempts, all recorded in [docs/decisions.md](docs/decisions.md):
Koyeb's free plan closed to new signups when Mistral acquired them in February 2026;
Northflank's own docs require a payment method "even on the free plan" whatever the
comparison sites claim; Back4App issues a URL that expires after 60 minutes.

Render was initially rejected because its free tier has no WebSockets — **which was the
wrong reason to reject it**. SignalR negotiates transports and falls back to Server-Sent
Events, then long polling. The board still syncs; it just costs more HTTP round trips.
Treating a performance characteristic as a hard blocker cost three platforms.

Two consequences of the free tier worth knowing:

- **The API sleeps after 15 minutes idle**, and the first request back takes 30–60
  seconds. The client already handles this — `withAutomaticReconnect()`, then `Resync`
  replays operations since the last seen `seq`, falling back to a snapshot past a
  200-operation gap. The reconnecting banner appears and clears on its own.
- **Neon suspends compute after 5 minutes** but resumes without intervention.

Render's own free Postgres is deliberately unused: it is deleted after 90 days.

### Releasing

```bash
git push origin main        # CI runs; if green it advances `deploy`
```

That push is the whole procedure. CI advancing `deploy` is itself the backend deploy —
Render's Auto-Deploy is *On Commit*, watching `deploy` — and a second CI job then releases
the frontend once the backend is confirmed live.

**Backend first.** An API returning extra fields does not break an old frontend, but a
frontend reading a field the deployed API does not send yet does break. CI enforces that
ordering rather than trusting anyone to remember it: the `ship` job polls `GET /health`
until the `commit` it reports matches the SHA just promoted, then advances `release`, which
is what Vercel builds.

It then waits for Vercel the same way, against `GET /api/health` on the frontend. Advancing
a branch is not a deploy, only the trigger for one, so checking just the backend would leave
a failed Vercel build looking exactly like a successful release.

Both ends report their commit for this reason — Render injects `RENDER_GIT_COMMIT`, Vercel
injects `VERCEL_GIT_COMMIT_SHA` — so "is it live?" is a question with an answer rather than a
timer to guess at. If the backend never matches, `release` is left where it was, which is the
safe direction; if the frontend never matches, the backend is already live and the Vercel
build is what needs looking at. `git ship` remains as a manual fallback.

**Auto-Deploy is safe here only because it watches `deploy`.** The gate is the branch, and
CI is what moves it. Pointed at `main` the same setting would remove the gate completely.

**A migration that rewrites data now applies unattended** — the one thing the old manual
click bought. Turn Auto-Deploy off before pushing that class of change, deploy it by hand,
then turn it back on.

#### How the three branches work

| Branch | Meaning | Moved by | Built by |
|---|---|---|---|
| `main` | latest work | you | nothing |
| `deploy` | last commit that passed CI | CI | Render |
| `release` | what production serves | `git ship` | Vercel |

Neither host watches `main`, so nothing red reaches production and **no deploy tokens exist
in the repository** — the gate is the branch rather than the trigger.

The two hosts deliberately watch *different* branches: that is what makes ordering
possible. Render's free plan has no auto-deploy, so the backend is manual regardless. Were
Vercel also pointed at `deploy`, the frontend would always deploy first — Render can only
build a commit already on `deploy`, by which time Vercel would have shipped.

> Do **not** use Vercel's *Ignored Build Step* to make the frontend manual. Setting it to
> "Don't build anything" also cancels manually created deployments, leaving no way to
> deploy at all. Verified: a Create Deployment from `deploy` returned
> `Build Canceled — as a result of running the command defined in the "Ignored Build Step"
> setting`.

If `git ship` is missing (fresh clone), recreate it:

```bash
git config --local alias.ship '!git fetch origin --quiet && git push origin origin/deploy:release'
```

> Do **not** use Vercel's *Ignored Build Step* to make the frontend manual. Setting it to
> "Don't build anything" also cancels manually created deployments, leaving no way to
> deploy at all. Verified: a Create Deployment from `deploy` came back
> `Build Canceled — as a result of running the command defined in the "Ignored Build Step"
> setting`.

### One-time setup

1. Neon: create the database and copy the connection string — pick the **.NET / Npgsql**
   format, not the default `postgres://` URI, which Npgsql cannot parse.
2. Create the deploy branch: `git push origin main:deploy`.
3. Render → New Web Service → this repo, branch **`deploy`**, root directory `backend`,
   runtime **Docker**, Dockerfile `./backend/Dockerfile`, instance type Free. Render
   injects `PORT`; [`backend/Dockerfile`](backend/Dockerfile) already reads it.
4. Render environment variables:

   | Name | Value |
   |---|---|
   | `CONNECTIONSTRINGS__POSTGRES` | the Neon connection string |
   | `FIREBASE__PROJECTID` | your Firebase project id |
   | `CORS__FRONTENDORIGIN` | the Vercel URL — **no trailing slash** |
   | `DATABASE__MIGRATEONSTARTUP` | `true`, so the schema is applied on boot |

   Uppercase names work because .NET configuration keys are case-insensitive:
   `CONNECTIONSTRINGS__POSTGRES` binds to `ConnectionStrings:Postgres`. Verified by
   running the image with only these names — it booted, migrated a fresh database, and
   returned the configured origin on a CORS preflight.
5. Vercel: import the repo with root directory `frontend`, then point production at the
   release branch — **Settings → Environments → Production → Branch Tracking → `release`**.
   (This lived under Settings → Git in older versions of the dashboard.) Leave *Ignored
   Build Step* on **Automatic**. Set the six
   `NEXT_PUBLIC_FIREBASE_*` values plus
   `NEXT_PUBLIC_API_BASE_URL` pointing at the Render URL — again **no trailing slash**, or
   every request becomes `//health` and 404s.
6. Firebase console → Authentication → Settings → Authorized domains → add the Vercel
   domain. **Sign-in fails without this**, and the error is easy to misread.

The two URLs reference each other, so: deploy the backend, point Vercel at it, deploy the
frontend, then set `CORS__FRONTENDORIGIN` and redeploy the backend.

## Known gaps

- **Invites are in-app only** — no email delivery. The invitation link is copied and
  sent by hand, because every transactional email service wants a custom domain and
  this project has no budget for one.
- **Presence is single-instance.** The tracker is in-memory, so horizontal scaling needs
  a Redis-backed `IPresenceTracker`. Deliberately not built: free hosting gives exactly
  one instance, so it would be code nothing exercises.
- **No card key.** Nothing here has a `TAN-14` to quote in a standup. It needs a
  per-board counter with the same atomic-increment care as `seq`, which is schema rather
  than decoration — so the card header deliberately leaves the space empty rather than
  filling it with a word that is true of everything.
- **Theme is per-device.** Stored in `localStorage`, so it does not follow you between
  browsers — see [docs/decisions.md](docs/decisions.md) for why a database column could
  only sit on top of that rather than replace it.
- **`npm audit` is not in CI.** The backend's dependencies are checked on every build
  and the frontend's are not, so nine Next.js advisories shipped until somebody thought
  to look. The gate exists for one half of the stack only.
- **The endpoint census covers 25 of 35 endpoints.** It fails anything it measures with
  no budget, so the rule holds for everything it calls — but the six deletes, both
  membership mutations, unarchive and the three invitation endpoints are never called by
  it, because setting up the next measurement never requires walking them.

See [docs/decisions.md](docs/decisions.md) for the architecture decisions and
divergences behind each slice.
