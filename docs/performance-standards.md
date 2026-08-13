# Performance standards

Sibling to [`ui-standards.md`](ui-standards.md), and written the same way: every rule
below is here because it was learned expensively, and the ones that could be enforced by
a test are.

**The reason this file exists.** A card took 3.1 seconds to move on the deployed app while
the same request took 4 milliseconds locally, and nothing in the codebase, the tests or the
logs could say why. Three explanations fit the evidence equally well and needed opposite
fixes. What follows is what closed that gap, generalised.

---

## P1 — Measure before you conclude

**P1.1 — A number without a breakdown is not evidence.** "The move takes 3 seconds" admits a
slow query, a distant database, a starved CPU and a blocked broadcast. Those have nothing in
common except the total, and four of the five things tried in this phase would have been the
wrong fix at some point in the investigation.

**P1.2 — Every response carries `Server-Timing`.** It is on in production, deliberately —
production is the only place the interesting latency exists. Locally the database answers in
under a millisecond, so a profiler here shows a request path that looks healthy and is three
seconds slower once deployed.

```
Server-Timing: db;dur=93.0;desc="7 round trips, slowest 17ms",
               conn;dur=0.0;desc="4 opened", push;dur=4.1,
               app;dur=34.9, total;dur=128.0
```

**P1.3 — Split waiting from working.** `db`, `conn` and `push` are all *waiting on something
else*; `app` is work. They are separate metrics because they lead to different fixes, and
because `app` is a residual — anything unaccounted lands there, which is itself a signal.

**P1.4 — The distribution discriminates, not the total.** Twelve round trips totalling 2.1s
with a slowest of 175ms is *flat*: every statement costs the same regardless of what it asks
for, which is the signature of a wire, and the fix is fewer trips or a closer database. The
same 2.1s with a slowest of 2.0s is one missing index. This is why `db` carries the slowest
single trip alongside the count.

**P1.5 — Two probes, so a single round trip has a price.** `/health` costs a request and no
database; `/health/db` costs a request and exactly one `SELECT 1`. The difference between
their headers is what one round trip costs *on the deployment you are asking about*. Both are
anonymous, because an authenticated probe excludes every tool that would otherwise watch it.

**P1.6 — State the hypothesis, then try to kill it.** The broadcast being awaited on the
request path was a good theory with a plausible mechanism, and measuring it returned
`push;dur=4.1`. An hour of making writes fire-and-forget was avoided by adding one metric.

---

## P2 — Round trips are the unit

**P2.1 — Count round trips, never time, in tests.** A timing assertion measures the machine
running it. Round trips are a property of the code and identical everywhere; the price of one
is a property of the deployment. Multiply them for the latency.

**P2.2 — Every endpoint has a budget, and it is today's actual count.** Not a generous
ceiling — the exact number, so any addition fails on the machine that made it. See
`EndpointCensusTests`. Lower them as work lands; never raise one without saying what bought
the extra trip.

**P2.3 — Census the whole surface, not the endpoint you are looking at.** Four endpoints were
pinned before this phase, and the costliest problem was in machinery all thirty-one shared.
Optimising the one that was noticed would have missed it.

**P2.4 — Measure only successful calls.** A census that includes a 400 records the cost of
the refusal and presents it as the endpoint's cost, which is worse than not measuring because
it looks like data.

**P2.5 — Warm before measuring.** The first authenticated request creates the user row. That
write is real, and no steady-state request repeats it.

### Today's floor

A mutation costs **6–7**: one query for the caller, one or two for the entities, and four for
`SaveAsync` — `BEGIN`, the seq `UPDATE … RETURNING`, `SaveChanges`, `COMMIT`. A read costs
**2–3**.

Two thirds of a write is therefore the transaction, and that is left alone on purpose.
Collapsing it into a hand-written CTE would save ~25ms and trade away the guarantee every
operation in the system depends on.

---

## P3 — Ask once

**P3.1 — Never ask the database something the request already knows.** Every mutation used to
re-read the caller's membership to check a role, two queries after the loader had fetched
those same rows and discarded everything but the workspace ids. `ICurrentUserService` now
carries the roles and answers from memory.

**P3.2 — Per-request state is not a cache.** The distinction is what keeps P3.1 safe. The
service is scoped to the request and dies with it, so tenant scope and role are still
re-derived on every request and every hub call — which is what stops a removed member acting
on a long-lived connection. Caching across requests would break that invariant.

**P3.3 — Load the row and the permission to touch it together.** A card reaches its workspace
through `Column.Board`, a comment through `Card.Column.Board`. Those are joins the database
was already positioned to make, so the authorization check rides out of the query the
operation had to run anyway.

**P3.4 — Extra columns are free; extra conversations are not.** `DeleteCardAsync` loads labels
and a comment count it does not need, because the alternative was a second round trip to learn
the workspace.

**P3.5 — Project, don't `Include`, when you want columns rather than entities.** `Include`
materialises whole entities into the change tracker. The user loader reads two columns off
each membership row and has no use for the rest.

**P3.6 — But project entities when navigation fixup has to happen.** `LoadCardContextAsync`
projects `CardLabel` rows as entities rather than DTOs, because `ToResponse` reads
`card.CardLabels`. Projecting only the labels leaves the join collection empty and every
response silently loses its labels. Verify by count: if the projection split into extra
queries, the census says so immediately.

---

## P4 — Locality beats cleverness

**P4.1 — Check where the database is before optimising queries.** Neon in Singapore and Render
in Ohio made every statement cost 207ms. Twelve round trips is a defensible design at 2ms a
trip and indefensible at 207ms, and no amount of reading the code reveals which one you have.

**P4.2 — The config change usually wins.** Moving the database was worth **2.3 seconds** and
took an environment variable. Two rounds of query folding across the entire backend were worth
**~60ms**. Do both, in that order.

**P4.3 — Move the cheaper end.** Render cannot change a service's region and Neon cannot change
a project's, so both mean recreate-and-repoint. Moving the *database* keeps the API's URL,
which keeps CORS, Firebase and the frontend's build-time `NEXT_PUBLIC_API_BASE_URL` untouched.

**P4.4 — Know the floor you cannot code past.** `/health` returns a constant and touches
nothing: 0.5ms server-side, ~290ms from a browser. That ~290ms is edge-to-origin transit and
no query work goes below it.

---

## P5 — Accept the cold path

**P5.1 — Free tiers scale to zero, and that is the deal.** Neon suspends compute after 5
minutes idle; the next request pays ~1200ms across four fresh connections plus inflated
queries against a cold instance. Render spins the service down after 15.

**P5.2 — Do not keep-alive your way out of it.** A `SELECT 1` every four minutes would hold
compute continuously — ~730 hours a month against a free tier granting ~192. The scale-to-zero
is what makes the rest free.

**P5.3 — Say so in the UI instead.** The board's slow-load note exists for this, and per S3.1
it describes the wait rather than the infrastructure causing it.

**P5.4 — Do not read a cold sample as steady state.** The first request after a deploy or a
pause inflates everything at once — connections, queries and residual time together. Uniform
inflation across unrelated metrics means the whole path is cold, not that one component is
slow.

---

## What this bought

| | Before | After |
|---|---|---|
| Move, server-side | 4222ms | 128ms |
| Round trips | 12 | 7 |
| Cost of one round trip | 207ms | 14.8ms |

The database move accounts for almost all of it. The code work accounts for ~60ms and removed
a genuine design fault — an authorization answer fetched twice per write through two different
paths. Both were worth doing. Only one of them was findable by reading the code.
