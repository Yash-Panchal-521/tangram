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
end. [`docs/roadmap-v2.md`](docs/roadmap-v2.md) covers what comes next.

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
- **Real-time sync spine (server-authoritative):** every mutation — eight operation
  types across columns and cards — runs the same pipeline: authorize → validate →
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
- **Presence & resync:** in-memory presence tracker, connection-counted per user so
  two tabs don't flicker. On reconnect the client replays operations since its last
  seen `seq`; past a 200-operation gap the server tells it to refetch a snapshot.
- **Theming:** CSS custom-property design tokens (`--bg`, `--surface`, `--accent`, …)
  mapped into Tailwind's `@theme`, keyed by `[data-theme][data-mode]`. One finalized
  theme (Terracotta, light + dark); more drop in without touching component code.

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

The API listens on `http://localhost:5286`. In Development, Swagger UI is at
`/swagger` and the OpenAPI document at `/openapi/v1.json`.

### Running backend tests

19 integration tests spin the API up in-memory (`WebApplicationFactory`) against the
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

## Using it

1. **Sign up** at `/signup`, then name your workspace, pick a column template and
   optionally invite people on the `/welcome` screen. Everything there has a default;
   **Skip** produces a workspace, a board and three starter columns.
2. **Invite someone** — click **Members** in the board header, enter one or more
   addresses, pick a role per person, send.
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

To see real-time behaviour solo, open the same board URL in two tabs.

### Routes

| Route | Purpose |
|---|---|
| `/login`, `/signup` | Firebase email/password auth; `?next=` returns you mid-flow, `?invite=` shows the invitation |
| `/welcome` | First-run setup — workspace name, column template, invites |
| `/invite/[token]` | Accept or decline an invitation; `?accept=1` on the way back from sign-up |
| `/board` | Resolves which board to open from your memberships |
| `/boards` | Every workspace and board you belong to |
| `/board/[boardId]` | The collaborative board |
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

Then, once CI is green:

1. **Backend** — Render → **Manual Deploy → Deploy latest commit**
2. **Frontend** — `git ship`

`git ship` is a repo-local alias that moves `release` to whatever `deploy` points at;
Vercel deploys `release` automatically. It promotes the last CI-verified commit, not your
working tree, so it can only ever release code that passed.

**Backend first.** An API returning extra fields does not break an old frontend, but a
frontend reading a field the deployed API does not send yet does break. Skip step 1
entirely when the change is frontend-only.

**Wait for CI before clicking Render**, or you will deploy the previous green commit.

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

- **No workspace/board picker.** `/board` opens your first board; there's no screen
  to switch between several.
- **Invites are in-app only** — no email delivery, no shareable join link.
- **Presence is single-instance.** The tracker is in-memory, so horizontal scaling needs
  a Redis-backed `IPresenceTracker`. Deliberately not built: free hosting gives exactly
  one instance, so it would be code nothing exercises.
- **No frontend tests.** 20 on the backend, none on the front — despite the sync
  reducer, rank ordering and invite parsing all being pure, testable logic.
- **"Add column" still uses `window.prompt`.** Every other dialog is in-app.

See [docs/decisions.md](docs/decisions.md) for the architecture decisions and
divergences behind each slice.
