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
| C5 | Loading and empty states | Board skeleton replacing "Loading board…"; audit the small board components |
| C2 | Board view | Column and board empty states, card visuals, pending feedback, header density, drag affordance |
| C3 | Card detail | Dialog semantics, Cmd+Enter save, unsaved-change guard, layout |
| C4 | Auth pages | Auth-checking state, password requirements shown before submit |
| C1 | Onboarding | Last, so it showcases a board that is already excellent |
| C6 | Guided walkthrough | **After C2/C3 — see below** |

### C6 — guided walkthrough, deliberately deferred

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

## Phase 2 — features

Chosen for v2:

### 1. Activity feed + undo

Per-board timeline of who changed what and when, plus undo for the last operation.

Both fall out of infrastructure that already exists: the append-only `operations` table
with a per-board `seq`, written by `BoardOperationService.SaveWithOperationAsync` and
already carrying `ActorId`, `OpType` and the full payload. This needs an endpoint and a UI,
not new architecture — no other feature here has that leverage. The real work is
inverse-operation logic for undo.

### 2. Workspace and board management

A home screen listing workspaces and their boards; create, rename and archive boards;
switch between them.

Today `/board` opens your first board and there is no way to have or reach a second, so the
multi-tenant model the backend enforces is invisible to a user. Largest product gap.

### 3. Card depth — labels, due dates, assignees, comments

Coloured labels, due dates with overdue styling, assignment to a member, and a comment
thread per card.

Largest schema surface of the three: new tables, and new operation types on the sync spine —
each must go through `SaveWithOperationAsync` like every other mutation, and each needs a
matching case in the frontend reducer.

*Not selected: command palette and keyboard shortcuts.*

## Known overstatement to resolve

The sign-in page advertises **"Offline-tolerant sync"**. The app reconnects and replays
operations since the last seen `seq`, but it does not queue mutations made while offline.
Either implement the queue or change the copy — currently the claim is not true.
