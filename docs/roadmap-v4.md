# v4 — the three-second card move

## The goal, in a sentence

A card took 3.1 seconds to move on the deployed app and 4 milliseconds locally;
v4 is the work of finding out why and making sure the next endpoint cannot
quietly do the same thing.

v3 made the app look like a product. It also made the slowness impossible to
ignore: a real-time collaborative board where dragging a card takes three seconds
contradicts its own headline claim.

## How it was worked

**Instrument, then conclude.** The one number available at the start — 3.1
seconds — fitted at least three explanations that need opposite fixes: twelve
round trips over a slow link, one slow query, or a starved CPU. Every phase below
begins with a measurement and several of them end by killing a plausible theory.

## What happened, in order

**Phase 0 · instrumentation.** Every response gained a `Server-Timing` header:
database time, round-trip count, the slowest single round trip, connection-open
time, broadcast time, and the residual. On in production deliberately — locally
the database answers in under a millisecond, so a profiler here shows a request
path that looks healthy and is three seconds slower once deployed.

The slowest-trip figure is the one that discriminates. Twelve trips totalling
2.1s with a slowest of 175ms is *flat*: every statement costs the same regardless
of what it asks for, which is a wire rather than a query plan.

**Phase 1 · pricing one round trip.** `/health` costs a request and no database.
`/health/db` costs a request and exactly one `SELECT 1`. The difference is the
price of a single round trip on the deployment being asked about: **216ms**. No
local measurement could have produced that number.

**Phase 2 · the database was on the wrong continent.** Neon in Singapore, Render
in Ohio. Nothing in the codebase implied it and nothing could have. Moving the
project to `us-east-2` took an environment variable and a 32MB dump/restore, and
took one round trip from 216ms to **14.8ms**.

**Phase 3 · a census of all 31 endpoints.** Four had been pinned; the costly
problem was in machinery all of them shared. Every authenticated request spent
two round trips resolving the caller, and every mutation spent two more
re-establishing an authorization answer the request already held. Fixing the
shared path moved every endpoint at once.

**Phase 4 · folding, endpoint by endpoint.** A card reaches its workspace through
`Column.Board`; a comment through `Card.Column.Board`. Those are joins the
database was already positioned to make, so the permission check rides out of the
query the operation had to run anyway. Ten call sites.

**Phase 5 · the rules.** [`performance-standards.md`](performance-standards.md),
enforced where it can be by `EndpointCensusTests`.

## The numbers

| | Start | End |
|---|---|---|
| Move, server-side | 4222ms | **128ms** |
| Move, client-side (warm) | ~3100ms | **~450ms** |
| Round trips | 12 | 7 |
| One round trip | 216ms | 14.8ms |
| `POST /columns/{id}/cards` | 10 trips | 6 |
| `GET /boards/{id}` | 5 trips | 3 |
| Endpoints with a pinned budget | 0 | 31 |

**The database move accounts for almost all of it.** Two full rounds of query
folding across the entire backend were worth ~60ms; an environment variable was
worth 2.3 seconds. That ratio is the most useful thing v4 has to say.

## Hypotheses that were wrong

Recorded because the discipline is the deliverable, not the fixes.

- **"The board's `@theme inline` bakes colours"** — from v3, same failure mode:
  concluded from a preview pane that reports stale computed styles, changed the
  directive, then found fresh elements had tracked correctly all along. Reverted.
- **"Dragging must be disabled while filtered"** — assumed the server ranks
  against visible neighbours. It ranks against real ones. The restriction would
  have been pure loss.
- **"The awaited SignalR broadcast is blocking writes"** — plausible, with a real
  mechanism: the writer's own browser is in the group, so backpressure while it
  re-renders would stall the response. Measured: `push;dur=4.1`. An hour of
  making writes fire-and-forget was avoided by adding one metric.
- **"The frontend is fine"** — asserted while cutting it from scope, without
  measuring, which is precisely what P1.1 forbids. Then measured: filtering is
  one pass over 500 cards, a one-card change produces one commit, and the largest
  response on the whole API is 1022 bytes. The conclusion was right and the
  reasoning was not, which is the part worth recording.

## What v4 deliberately did not do

- **Collapse `SaveAsync`'s transaction.** Four of a mutation's six or seven round
  trips are BEGIN, the seq `UPDATE … RETURNING`, `SaveChanges` and COMMIT — two
  thirds of what a write now costs. One hand-written CTE would save ~25ms and
  trade away the guarantee every operation in the system depends on.
- **Keep the database warm.** Neon suspends compute after 5 minutes idle, so the
  first request after a pause pays ~1200ms across four fresh connections. A
  `SELECT 1` every four minutes would fix it and consume ~730 compute-hours a
  month against a free tier granting ~192. The scale-to-zero is what makes the
  rest free.
- **Memoise the board tree.** Measured instead: one commit per change, no
  windowing needed at any board size this will see.
- **Add response compression.** Already applied — by Render's edge, as Brotli.
  Adding it in the app would burn free-tier CPU to do it twice.

## What it left behind

Three things outlive the numbers, and they are the actual deliverable:

- `Server-Timing` on every response, in production.
- `EndpointCensusTests` — all 31 endpoints, each pinned to its measured
  round-trip count, so an endpoint that grows a query fails on the machine that
  grew it.
- [`performance-standards.md`](performance-standards.md), which explains why both
  exist.

The expensive defect in v4 was invisible to code review and visible in one
measurement. That is the whole lesson.
