# v5 — what the browser pass found

Bugs found by driving the running app in Chrome, screen by screen, as each was
rebuilt against the v7 design. Written down rather than only fixed, because a
few of them say something about how they got in.

Fixed items name the commit. Open items are decisions, not oversights.

## Fixed

| # | Screen | Defect | Commit |
|---|---|---|---|
| 1 | Board — lanes | Lane rows could not scroll. The board area was one class set serving two views; `overflow-y-hidden` clipped the rows and, being a plain block, it gave `flex-1 min-h-0` nothing to resolve against, so the inner scroll pane grew to its content and could never overflow. | `40e6a71` |
| 2 | Board — lanes | Grouping by label removed the horizontal axis. One `droppable` flag governed both drag axes, and labels set it false for a vertical reason, so a card could not be moved between columns *at all* while grouped by label. | `aa5dac5` |
| 3 | Board — lanes | Priority view had no reachable drop targets. Empty lanes were hidden, so a card could only be dragged into *High* once something was already *High* — the handle was there and the gesture did nothing. | `aa5dac5` |
| 4 | Board — lanes | **Regression, self-inflicted.** The fix for #2 subscribed every cell to the drag with `useDndContext()`, re-rendering all of them on every pointermove. Dropping stopped working in every lane view and a synthetic drag left the renderer unresponsive. | `e21852b` |
| 5 | Members | The invite hint rendered "…columns and cards.**N**o account needed yet". The role blurb ends in a full stop and the next sentence began on the following source line, so JSX dropped the join. Pinned with a test — a missing space passes tsc, passes eslint, and is invisible in a diff. | `5dfed79` |
| 6 | Workspace home | Row actions were swallowed by the row's stretched click target. Caught before shipping with `elementFromPoint` rather than by eye, because a swallowed button looks exactly like a working one. | `da0928c` |
| 7 | Workspace home | The create-board form kept the old boxed style and appeared above the list rather than in the row the "+" occupied. | `da0928c` |
| 8 | Members / home | Both pages stated their own name twice — once in the top bar, once in the page title. | `5dfed79` |

## Resolved after review

**The card detail is a drawer** (`983adf4`) — decided, and my advice on it was
partly wrong. I reported that the design's detail carried no comment thread and
that ours therefore needed two columns. It does carry one (`act.thread`), in the
same 548px column. The trade-off was real — one column cannot keep Status on
screen while a long thread scrolls — but I had a fact wrong in the middle of it.

**There is no Activity screen in the design.** The `{{ act.* }}` block I read as
one is the active *card*: status chip, reference, up/down stepping, property
list, thread. It is the drawer above. Nothing here proposes bringing back the
activity feed or undo that `CLAUDE.md` records as deliberately removed.

**~~`GET /workspaces` cannot feed the design's board rows.~~** Closed in
`cdf4885`. The endpoint now returns `columnCount`, `cardCount` and
`overLimitColumns` as correlated subqueries on the projection that was already
there, so it stays at its measured 2 round trips — confirmed by running
`EndpointCensusTests`, not assumed.

The distribution bars and the per-board people followed in `3b7b8a9`, on the
same projection and still within the same 2 round trips.

**~~`MemberResponse` has no join date.~~** Closed in `3b7b8a9`. `JoinedAt` is
the membership's creation time, and re-inviting an existing member returns their
original date rather than restarting it.

## Still open

**Card stepping and a card reference.** The drawer's design has up/down arrows
to walk the board's cards and a `TG-140` reference. The reference needs a
per-board counter with the same atomic care as `seq` — schema, not decoration —
which is why the slot has been empty since v3. The stepping is a feature rather
than a restyle.

**The design includes an Activity screen.** `CLAUDE.md` records that the
activity feed and undo were removed deliberately, and that an inverse cannot be
reconstructed after the fact. Not built. Reintroducing it is a product decision
with a documented history behind it.

## Notes on method

Two false alarms are worth recording, because both looked like real bugs:

- **"yesterday" on cards created minutes earlier.** The operations log showed
  the server wrote them at 14:11 UTC on one day and "now" was 14:40 UTC the
  next, so roughly a day of real time had passed across a break. The label was
  right. Checking the write path before changing the display is what saved a
  fix to something that was not broken.

- **A drag that appeared to fail from bad coordinates.** `getBoundingClientRect`
  returns page coordinates and the screenshot-driven click tool takes screenshot
  coordinates; they happened to agree here (scale 1.02), which ruled the theory
  out rather than confirming it. The real cause was #4.

Synthetic drags need a *sequence* of `pointermove` events, not one. dnd-kit
activates on the first move past its 8px threshold and computes collisions on
the moves after it, so a single jump lands nothing.
