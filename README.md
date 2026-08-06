# Tangram

A multi-tenant, real-time collaborative kanban workspace. Multiple people edit the
same board live — drag cards, rename columns, watch each other's cursors — backed
by a server-authoritative sync pipeline (sequenced operations log, not last-write-wins
by clock time).

## Status

Four of five planned slices are in. The app is usable end to end: sign up, invite
a teammate by email, and both of you edit one board in real time under role-based
permissions.

| Slice | Scope | State |
|---|---|---|
| 1 | Walking skeleton — auth, tenant isolation, card create, seq/op-log/broadcast spine, design tokens | done |
| 2 | Drag-and-drop, full column/card CRUD, optimistic UI with rollback | done |
| 3 | Presence, live cursors, reconnect with delta resync | done |
| 4a | Workspace membership, email invites, sign-up, RBAC enforcement | done |
| 4b | Viewer read-only board UI | done |
| 5 | Workspace picker, Redis-backed presence, deploy/CI | not started |

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
  membership immediately; anything else writes a pending invitation that is claimed
  on that person's first authenticated request, before their workspace scope is
  resolved — so they see the workspace on that very first call.
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
cd backend && Firebase__ProjectId=test-project dotnet test
```

Two things to know:

- **`Firebase:ProjectId` must come from the environment or user-secrets, not
  `appsettings.Local.json`.** `Program.cs` reads it before the host is built, which is
  earlier than `WebApplicationFactory` can inject configuration, and the test project's
  content root isn't the API project's. `dotnet user-secrets set "Firebase:ProjectId" "…"`
  works too and saves repeating the variable.
- The suite expects `tangram_test` at `127.0.0.1:5433` with `postgres`/`postgres`.
  Override with `TANGRAM_TEST_POSTGRES` if your instance differs.

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

1. **Sign up** at `/signup`. First sign-in bootstraps a workspace, a board, and three
   starter columns.
2. **Invite someone** — click **Members** in the board header, enter one or more
   addresses, pick a role per person, send.
3. **Nothing emails them.** There is no mail delivery and no tokenised join link, so
   use **Copy invite** to get a ready-made message (including a `/signup?email=…`
   link) and send it yourself. The address must match exactly, or the invitation
   never resolves — which is why the link prefills it.
4. **Watch it sync.** With both of you on the board, cards, columns, presence avatars
   and cursors update live. Change someone to Viewer and their next edit is rejected.

To see real-time behaviour solo, open the same board URL in two tabs.

### Routes

| Route | Purpose |
|---|---|
| `/login`, `/signup` | Firebase email/password auth |
| `/board` | Resolves which board to open from your memberships |
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

## Known gaps

- **No workspace/board picker.** `/board` opens your first board; there's no screen
  to switch between several.
- **Invites are in-app only** — no email delivery, no shareable join link.
- **Presence is single-instance.** The tracker is in-memory, so horizontal scaling
  needs a Redis-backed implementation.
- **No CI.** The test suite exists but nothing runs it automatically.
- **"Add column" still uses `window.prompt`.** Every other dialog is in-app.

See [docs/decisions.md](docs/decisions.md) for the architecture decisions and
divergences behind each slice.
