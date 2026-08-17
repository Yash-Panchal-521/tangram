# v3 — the interface, reworked around Jira's shape

## The goal, in a sentence

Take Jira's shape and make Tangram look like a real product rather than a working
prototype — starting with the card as a ticket, then the board itself.

v1 and v2 built the machine: sequenced operations, tenant isolation, presence, RBAC,
invitations, card depth. All of it worked and none of it looked like anything. v3 changed
nothing about the spine and almost everything about the surface.

## How it was worked

One rule, and it is the reason the phases below hold together: **research the component
against Atlassian's own documentation before building it.** Not comparison articles — this
project has a documented history of getting platform decisions wrong from blog posts, which
is why `CLAUDE.md` says vendor docs win. Every phase below opens with what Jira actually
specifies, and several of the decisions are places where Jira's answer was *rejected* for a
stated reason.

Each phase shipped on its own and left the app coherent.

---

## Card — four phases

**Phase 0 · the ticket shell.** Two columns, as Jira lays out a work item: description
fields left because they are what the work *is*, context fields right because they are what
you sort and filter by. A modal over a dimmed board rather than a drawer or a page, because
on a kanban tool the surrounding columns are half the context. `?card=` in the URL, which is
what Jira does with `?selectedIssue=`, so a card is linkable without leaving the board.

Every field saves itself. One Save button had made four fields share one request's fate, and
`runMutation` swallowed the failure and closed the panel anyway — so a rejected save looked
exactly like a successful one.

**Phase 1 · priority.** One nullable enum, no new operation type. Defaults to None rather
than Jira's Medium: a priority on every card is a priority on nothing.

**Phase 2 · labels.** `Label` + `CardLabel`, board-scoped. Which labels a card carries rides
the ordinary card update rather than getting its own operations, because it is a field of
the card.

**Phase 3 · comments.** Fetched per card rather than with the board — labels are bounded and
travel with the card, comments are not. Deliberately not the activity feed that was deleted
in v2: that was *derived history*, machine-written from the operations log. A comment is
authored.

## Board — three phases, then the rest

**Phase 0 · lanes and one menu.** Columns became tinted lanes with an edge; the hover-only
delete became a `⋯` that is always there. `Menu` was extracted at the third copy.

**Phase 1 · filtering.** Text, assignee, label, priority, due window, recency — in the URL,
so a filtered board is linkable. Jira ships "Only My Work items" as a named quick filter;
here your own row is first in the People menu instead, because two controls holding the same
state disagree the moment somebody uses both.

**Phase 2 · work-in-progress limits.** Min and max per column, red over and amber under, as
Atlassian specifies. Advisory and never enforced: blocking a move would strand the work in
the previous stage, which is the opposite of what a limit is for.

**Then:** create-card and seed-columns dialogs replacing the per-column controls, a board
settings panel (which finally gave column reordering a UI — the endpoint had shipped in v1
with nothing calling it), a navigation sidebar, and six switchable colour palettes.

---

## What v3 deliberately did not do

- **A card key** (`TAN-14`). The most recognisably Jira thing on a card, and it needs a
  per-board counter with the same atomic-increment care as `seq`. Schema, not decoration.
- **Swimlanes.** Scoped, researched, not built. *(Built in v5.)*
- **Attachments, subtasks, linked items, issue types, watchers, story points, work log.**
  Each is a Jira staple; the context column is honest but shorter than Jira's.
- **Undo.** Still impossible for the reason `CLAUDE.md` gives: an inverse cannot be
  reconstructed after the fact.

## What v3 found that was already broken

Four of these predate v3 entirely, and the rework is what surfaced them:

- **Ranks were compared with the wrong collation.** `RankService` builds keys from
  `0-9A-Za-z` and compares ordinally; Postgres was ordering them under `en_US`. Moves threw
  500s, appends collided on duplicate keys, and the board drew in a different order than the
  server computed with. Both rank columns are `COLLATE "C"` now.
- **Column reordering had no UI at all**, despite the endpoint and the broadcast both
  shipping in v1.
- **`body` was `min-h-full`,** so every `h-full` beneath it resolved against `auto` — which
  is why the empty board's centred message sat at the top of a viewport-tall area with the
  classes to centre it already in place.
- **The walkthrough had a silently dropped step.** Steps whose target is missing are filtered
  out, so removing a button removed a step and said nothing.

And two the palettes introduced and then exposed: surfaces too close to tell apart in every
palette, and white hardcoded on an accent that is near-white in half of them. Both are now
tests rather than habits — see S1.2a–c in [`ui-standards.md`](ui-standards.md).

## Verification, honestly

Backend work is covered by integration tests against a real Postgres. Frontend work is
covered by Vitest, and the parts that could be reached without signing in were also driven
in a browser — the kitchen sink, the auth pages, the palettes.

**Everything behind sign-in was built without being seen.** The tooling used throughout does
not enter passwords, so the board, the card detail, the dialogs and the sidebar were verified
by test and by reading computed styles, never by looking. Several of the defects listed above
were found only when a screenshot arrived. That is the main methodological weakness of this
slice and it is worth stating plainly rather than leaving implied.
