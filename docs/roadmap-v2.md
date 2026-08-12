# v2 roadmap

MVP is complete and verified in production — two real accounts editing one board, presence,
cursors, RBAC and the read-only viewer UI all confirmed working on the deployed app.

v2 runs in two phases, deliberately in this order: the standard comes first so that
everything built afterwards has a bar to meet.

## Phase 1 — raise the experience, and define the bar

**The deliverable is not just better screens. It is `docs/ui-standards.md`**, a checkable
standard, plus a gate in `CLAUDE.md` requiring new UI to satisfy it and to state which
rules apply and how each is met. A standard that lives only in conversation dies at the
next compaction; this one has to be an artifact.

Rules must be checkable rather than aspirational. Intended coverage:

| Area | Shape of the rules |
|---|---|
| Components | Reuse `components/ui` before creating; theme tokens only, no raw colours |
| States | Every async surface has loading, empty, error and success — no silent failure |
| Errors | Say what happened *and* what to do; never surface raw provider text |
| Destructive | Confirm with consequence-specific copy, never a generic "Are you sure?" |
| Keyboard | Every action reachable, focus visible, Escape closes, focus returns to trigger |
| Motion | Respect `prefers-reduced-motion`; skeletons hold layout so nothing shifts |
| Performance | Prefer optimistic-with-rollback over a blocking spinner where it is safe |

Surfaces to lift: **onboarding (new)**, board view, card detail, sign-in and sign-up, and
the empty and loading states throughout. The members page is closest to the bar already and
is the working reference.

**Onboarding**: not a modal tour. The first board assembles itself while you watch, with a
second cursor demonstrating a drag, so the collaborative nature is *shown*. It is the one
property of this app a screenshot cannot convey.

### Scope C, in order

| | Item | Note |
|---|---|---|
| C0 | ~~Accessibility violations~~ **done** | `useDialog` now backs both overlays; column rename and delete are real buttons; cards are buttons with Space-to-lift, Enter-to-open. See `docs/decisions.md` |
| C5 | ~~Loading states~~ **done** | `Skeleton` primitive, board silhouette on both loading routes, `prefers-reduced-motion`. Board and column *empty* states stayed with C2, where they belong next to card visuals |
| C2 | ~~Board view~~ **done** | Empty states for board and column, clamped cards with a drag grip, pending placeholders for creates, theme moved into the account menu |
| C3 | ~~Card detail~~ **done** | Unsaved-change guard on every exit, Cmd/Ctrl+Enter save, a confirmation before delete, labelled fields. Brought jsdom in so this is covered by tests |
| C4 | ~~Auth pages~~ **done** | Session-checking state, labelled fields, the password rule ticked live, and the untrue "offline-tolerant sync" claim replaced |
| C1 | ~~Onboarding~~ **done** | A phantom teammate adds a card and drags it across, then says what you just saw. Machinery (`useSeenOnce`, `useSequence`, reduced-motion) built reusable for C6 |
| C6 | ~~Guided walkthrough~~ **done** | On demand from the account menu. Steps whose anchor is missing are dropped rather than left pointing at nothing |

### C6 — guided walkthrough, deferred then built

A step-through tour of the UI. Deferred until after C2 and C3 for three reasons, recorded
so the decision isn't relitigated:

1. **It collides with C1.** A self-assembling first board and a coach-mark tour are both
   first-run experiences competing for the same minute. They are one decision about what
   the first minute is, not two features.
2. **It would be built twice.** A tour anchors to specific elements, positions and copy —
   and C2/C3 move the card, the column header, the detail panel and the board header.
3. **A tour can hide UI that should be clearer.** If someone needs a coach mark to find
   "Add card", the affordance is wrong. Explaining it first lets the unclear thing survive.
   After C2/C3, the list of things still needing explanation is usually much shorter.

Meanwhile the cheaper version is already in scope: **just-in-time hints** in the empty
states — a column with no cards teaches adding, being alone on a board teaches inviting
(the members page already does this). Most of a tour's value, delivered where the question
actually arises, and it doesn't rot when the UI moves.

**Dependency:** build C1's machinery — step sequencing, spotlight, and "has this user seen
it" persistence — to be reusable, so C6 is assembly rather than invention.

**Outcome.** The dependency held. `useSequence` carried the walkthrough unchanged: a `null`
hold already meant "wait for the user", so the manual mode *was* the timed mode with a
different clock. `Spotlight` was the only genuinely new piece.

Reason 1 above did not stop applying once C6 existed, so the tour is **on demand only** —
"Show me around" in the account menu. It is a refresher for someone who asks, not a claim
on anyone's first minute.

## Phase 2 — features

Chosen for v2:

### 1. Activity feed + undo — **built, then removed**

Per-board timeline of who changed what and when, plus undo for the last operation.

Both fall out of infrastructure that already exists: the append-only `operations` table
with a per-board `seq`, written by `BoardOperationService.SaveWithOperationAsync` and
already carrying `ActorId`, `OpType` and the full payload. This needs an endpoint and a UI,
not new architecture — no other feature here has that leverage. The real work is
inverse-operation logic for undo.

**Outcome.** Built, shipped, and then removed at the product owner's call — the feed was
not what they wanted the board to be. The leverage prediction held: the feed itself was an
endpoint and a UI over a log that already existed. The prediction about undo was right and
then some — the stored payload records the state a mutation *produced*, never the state it
replaced, so inverses had to be captured at write time in new columns, and `column.delete`
had to snapshot its cards.

All of that is gone: the panel, both endpoints, the inverse columns and the snapshots.
The `operations` log stays, because resync reads it. Deleting a column or a card is now
final, which puts the weight back on the confirmations. See `docs/decisions.md`.

### 2. Workspace and board management — **done**

A home screen listing workspaces and their boards; create, rename and archive boards;
switch between them.

Today `/board` opens your first board and there is no way to have or reach a second, so the
multi-tenant model the backend enforces is invisible to a user. Largest product gap.

**Outcome.** `/boards` lists every workspace with its role and boards; boards can be
created, renamed and archived, and archived ones stay listed behind a disclosure rather
than vanishing. Archive is owner-only and refuses the workspace's last active board.
Creating a board turned out to be unauthorized entirely — a viewer could make one and then
be unable to put anything on it.

Verified: 53 backend tests and 169 frontend tests green.

### 3. Card depth — **done**, the second half in v3

Coloured labels, due dates with overdue styling, assignment to a member, and a comment
thread per card.

Largest schema surface of the three: new tables, and new operation types on the sync spine —
each must go through `SaveAsync` like every other mutation, and each needs a matching case
in the frontend reducer.

**Outcome.** Due dates and assignees are done — two columns on `Card`, flowing through the
existing update path, so no new operation type and no new reducer case were needed at all.
The prediction was right about the other two: **labels and comments each need their own
table**. Both were left not started rather than half-built, and both were built in v3 —
labels as a field of the card rather than as their own operations, comments fetched per
card rather than with the board. See [`decisions.md`](decisions.md) and
[`roadmap-v3.md`](roadmap-v3.md).

*Not selected: command palette and keyboard shortcuts.*

## Known overstatement — resolved in C4

The sign-in page advertised **"Offline-tolerant sync"**. The app reconnects and replays
operations since the last seen `seq`, but it does not queue mutations made while offline,
so the claim was not true. Changed to "Replays what you missed on reconnect", which is both
accurate and a better description of the part that was actually hard to build.

An offline mutation queue remains unbuilt, and is not currently planned.
