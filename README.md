# Tangram

A multi-tenant, real-time collaborative kanban workspace. Multiple people edit the
same board live — create cards, see each other's changes appear instantly — backed
by a server-authoritative sync pipeline (sequenced operations log, not last-write-wins
by clock time).

This is Slice 1 of a five-slice build: a walking skeleton that proves the full spine
end to end on one instance, plus the design-system foundation the later slices build on.

## Architecture in brief

- **Frontend:** Next.js (App Router, TypeScript, Tailwind v4). The board is a client
  component talking to the backend over REST + a SignalR WebSocket connection.
- **Backend:** ASP.NET Core Web API (.NET 10) + SignalR.
- **Database:** PostgreSQL via EF Core, code-first migrations.
- **Auth:** Firebase Authentication issues ID tokens (email/password); the backend
  validates them as JWT bearer tokens against Firebase's issuer/public keys — the
  backend never sees a password and does no auth logic of its own.
- **Real-time sync spine (server-authoritative):** every mutation — right now, just
  card creation — is: validate → assign the next per-board `seq` in a single atomic
  `UPDATE ... RETURNING` → persist the change → append a row to the append-only
  `operations` log → broadcast `{seq, opType, payload}` to that board's SignalR group.
  Conflicts resolve by server `seq` order, never wall-clock time.
- **Tenant isolation:** EF Core global query filters scope every query to the
  caller's workspace memberships, resolved fresh on every request/hub call (not
  cached on the connection) so RBAC is enforced per-event, not just at connect.
- **Ordering:** columns and cards use fractional/lexicographic string ranks, so
  inserting a new item only ever writes one row.
- **Theming:** CSS custom-property design tokens (`--bg`, `--surface`, `--accent`, …)
  mapped into Tailwind's `@theme`. One finalized theme (Terracotta, light + dark) is
  wired up for Slice 1; the token architecture is built so more themes drop in later
  without touching component code.

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) 20+ and npm
- [PostgreSQL](https://www.postgresql.org/download/) 16+ running locally
- A [Firebase](https://console.firebase.google.com/) project with the **Email/Password**
  sign-in provider enabled

## Backend setup

```bash
cd backend/src/Tangram.Api

# One-time: local secrets (never commit real connection strings/keys)
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:Postgres" "Host=localhost;Port=5432;Database=tangram_dev;Username=postgres;Password=<your-password>"
dotnet user-secrets set "Firebase:ProjectId" "<your-firebase-project-id>"

# Create the database, then apply migrations
psql -U postgres -c "CREATE DATABASE tangram_dev;"
dotnet tool install --global dotnet-ef   # if you don't already have it
dotnet ef database update

dotnet run --launch-profile http
```

The API listens on `http://localhost:5286` by default (see `Properties/launchSettings.json`).

**Creating a test user:** Slice 1 only implements sign-*in* (sign-up is Slice 4).
Create a user directly in the Firebase console under **Authentication → Users → Add user**.

### Running backend tests

```bash
cd backend
psql -U postgres -c "CREATE DATABASE tangram_test;"
dotnet test
```

The test suite spins up the API in-memory (`WebApplicationFactory`) against the
`tangram_test` database and covers the two critical paths for this slice:

- **Tenant scoping** — a user outside a workspace gets a 404 reading its board.
- **Card-create spine** — creating a card assigns a `seq`, writes an `operations`
  row, and broadcasts the event to a connected SignalR client in the board's group.

## Frontend setup

```bash
cd frontend
cp .env.example .env.local   # fill in your Firebase web app config + API base URL
npm install
npm run dev
```

Open `http://localhost:3000`. Log in with the Firebase user you created above — the
app bootstraps a workspace, a board, and three starter columns on first login (there's
no "list my workspaces" screen yet; that's Slice 4), then drops you on the board.
Open the same board URL in a second tab and add a card in either one — it appears in
both in real time over the SignalR connection.

## Project structure

```
/frontend      Next.js app (App Router, TS, Tailwind)
/backend
  /src/Tangram.Api        ASP.NET Core Web API + SignalR + EF Core
  /tests/Tangram.Api.Tests xUnit integration tests
/docs          architecture/decision notes, growing per slice
```

## Out of scope for this slice

Drag-and-drop, column/card rename/delete, optimistic-UI rollback, presence, live
cursors, reconnection/resync, full RBAC enforcement, onboarding UI, and deploy/CI —
all later slices. See `tangram_docs/Tangram_Implementation_Plan.md` for the roadmap.
