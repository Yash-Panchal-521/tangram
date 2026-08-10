# Tangram — working notes for coding agents

Multi-tenant real-time collaborative kanban. ASP.NET Core 10 + SignalR + EF Core,
Next.js 16 + React 19 + Tailwind v4, PostgreSQL, Firebase Auth.

Live: <https://tangram-mu.vercel.app> · API <https://tangram-hk8a.onrender.com>

**This file holds rules and gotchas — things that are easy to get wrong.** History and
rationale live elsewhere and should not be duplicated here:

- [`docs/decisions.md`](docs/decisions.md) — why each decision was made, per slice
- [`docs/roadmap-v2.md`](docs/roadmap-v2.md) — what v2 is, in two phases
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

## Invariants — violating these breaks correctness

**Every board mutation goes through `BoardOperationService.SaveAsync`.**
It assigns the next per-board `seq` per operation in one atomic `UPDATE … RETURNING`,
persists, appends to the `operations` log, then broadcasts — after the commit, never
inside it. Conflicts resolve by server `seq`, never wall-clock time. Adding a mutation
path that skips it silently breaks sync.

**Every mutation must also record its inverse.** The payload stores the state an
operation *produced*, never the state it replaced, so undo cannot be reconstructed
afterwards — a rename that doesn't capture the old title before assigning the new one is
permanently un-undoable. Deletes must snapshot enough to rebuild what the cascade takes:
`column.delete` stores its cards. An operation with a null `InverseOpType` is silently
not undoable, which is correct for undos themselves and a bug anywhere else.

**Writes are REST-only; the hub is broadcast-only.** `BoardHub` exposes no mutations.
One write path means one place enforcing authorization and assigning `seq`.

**Broadcast application must stay idempotent.** Resync replays operations the client may
already have applied, so `applyOperation` replaces state by id rather than appending.

**Tenant scope is re-derived per request and per hub call**, never cached on the
connection. EF global query filters read `ICurrentUserService.WorkspaceIds`, populated by
`CurrentUserLoader`. A non-member gets 404 from the filter before any role check runs —
so "not found" and "not permitted" are deliberately conflated.

**Invitation claiming must run before `workspaceIds` is computed** in
`CurrentUserLoader.LoadAsync`. Claim after that point and a freshly joined workspace stays
invisible until the *next* request.

**Emails are normalized through `EmailAddress.Normalize` on both sides.** Claiming is an
exact index lookup; unnormalized input silently never resolves.

**Firebase is authoritative for display names, but a token without a `name` claim must
never overwrite a stored name** with the email-local-part fallback. That fallback is for
row creation only. Read both `"name"` and `ClaimTypes.Name` — JwtBearer's inbound map may
rewrite it.

**A workspace always keeps at least one owner.** Enforced server-side; the UI mirrors it
by disabling the control rather than letting the request 400.

**Ranks are fractional lexicographic strings.** Order by string comparison, never array
position. Inserting or moving writes exactly one row.

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
cd backend && dotnet test    # 85 integration tests, needs tangram_test on :5433
cd frontend && npm test      # 230 Vitest tests, node by default
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

`git push origin main` → CI advances `deploy` if green. Then, in this order:

1. Render → **Manual Deploy** (builds `deploy`)
2. `git ship` — repo-local alias; moves `release` to `deploy`, Vercel follows

| Branch | Moved by | Built by |
|---|---|---|
| `main` | you | nothing |
| `deploy` | CI, when green | Render |
| `release` | `git ship` | Vercel |

**Backend first**, because an API returning extra fields won't break an old frontend but a
frontend reading a field the deployed API doesn't send yet will. Frontend-only changes can
skip step 1. Wait for CI before clicking Render, or it deploys the previous green commit.

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
