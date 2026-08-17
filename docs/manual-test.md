# Manual test pass — the app as it stands

Supersedes `manual-test-v2.md`, which described the board before v3 reworked it:
per-column add buttons, no filters, no sidebar, no settings panel, no themes. Roughly
half its checks referred to controls that no longer exist.

Each check is **Do → Expect**. Where a wrong result would still look plausible, there is a
**Why** line — those are the ones worth reading before you click.

**Read this before starting.** This was written after v3, when everything behind sign-in had
been verified by automated test rather than by eye — the suites passed while the board's lanes
were invisible in every palette, while white text sat on a near-white panel, and while column
moves returned 500.

That is no longer the whole story. v5 was driven by hand in a signed-in browser, and §15 below
covers what it changed. The v5 defects are worth knowing about because of what they have in
common: **every one of them passed the test suite.** A drag that animated back to the wrong
column, a card that appeared three times and lifted the wrong copy, your own cursor following
you across a duplicated tab, a chevron floating outside the sidebar — none of these are things
an assertion was ever going to notice. Treat §1, §12 and §15 as the highest-value sections.

## Setup

```bash
docker start tangram-pg
```

```bash
cd backend/src/Tangram.Api && dotnet run --no-launch-profile --urls http://localhost:5400
```

```bash
cd frontend && npm run dev
```

`frontend/.env.local` must point `NEXT_PUBLIC_API_BASE_URL` at whatever port the API bound
to, with **no trailing slash**. Two browsers (or one plus a private window) and two accounts
are needed from §11 onward.

---

## 1. Themes — do this first, and in both modes

Every palette is a different set of surfaces, and the failures here are invisible to the
test suite until somebody looks.

| Do | Expect |
|---|---|
| Account menu → Theme → each of the six, in **light** | The board's columns read as distinct lanes against the board behind them. Card edges are visible. |
| Repeat every palette in **dark** | Same. Graphite dark is the hardest: near-white accent, near-black everything else. |
| On each, open a card | The dialog's edge is visible against the dimmed board; the context column is distinguishable from the description. |
| Sign out and look at `/login` in Graphite dark | The brand panel is near-white with **dark** text. If any of it is white-on-white, S1.2c has regressed. |
| Reload after switching | The palette survives, and there is no flash of the previous one on first paint. |

**Why:** the token separation and the accent pairing are pinned by
`globals.contrast.test.ts`, but nothing tests what a *component* composes out of them.

---

## 2. Sign-up, welcome, first board

| Do | Expect |
|---|---|
| Sign up with a fresh address | Straight to `/welcome`. No flash of the board first. |
| Welcome: pick a template, submit | Board created with that template's columns, in order. |

---

## 3. An empty board

| Do | Expect |
|---|---|
| Create a second board from `/boards` | Opens empty, with the message centred vertically — not sitting at the top of a tall blank area. |
| "Add columns" | Dialog: three templates, and a Custom option. |
| Custom → type `To Do, In Progress,, Done,` | Chips show **three** columns. The empty entries and the trailing comma vanish, visibly. |
| Type nine names | Refuses before sending, naming the limit. |
| Pick a template → Add columns | All of them appear at once. **Why:** one request, so a failure leaves none rather than a half-built workflow. |

---

## 4. Creating cards

| Do | Expect |
|---|---|
| **Create** in the header, or press **c** | Dialog opens with the first column preselected. |
| Press **c** while a card is open | Nothing. It is a letter someone is about to type. |
| Fill in title, description, status, assignee, priority, due, labels → Create | The card appears complete. It does **not** appear bare and then acquire its fields. |
| Turn on a label filter the new card will not match, then create one | A warning appears *as you type*, offering to clear the filter. The card is still created if you proceed. |
| Stop the API, then create | The dialog stays open, says why, and keeps what you typed. |

---

## 5. The card as a ticket

| Do | Expect |
|---|---|
| Click a card | Two columns. Description left, Details right. URL gains `?card=`. |
| Copy that URL into the other browser | The same card opens. |
| Back | Closes the card, does not leave the board. |
| Edit the summary in one browser | Updates in the other **and** in the open card there. |
| Edit description → Escape | Reverts, and the card stays open. |
| Stop the API, edit one field | That field reverts and explains itself. The others are untouched. |
| Open Status, Assignee, Priority | Each list is styled like the app — not a white system dropdown. Arrow keys move, Enter chooses, Escape closes without choosing. |
| Choose the value already selected | Nothing is sent. |
| Card `⋯` → Copy link | Says "Link copied". Reopen the menu — it says "Copy link" again, not a stale confirmation. |
| Card `⋯` → Delete card | Names the card and says it cannot be undone. |
| With the delete confirmation open, press Escape once | The confirmation closes. **The card stays open.** |
| Open the due date calendar, press Escape once | The calendar closes, the card stays open. |

---

## 6. Comments

| Do | Expect |
|---|---|
| Type two lines with Enter between them | A paragraph. Nothing is sent. |
| Ctrl/⌘ + Enter | Sent, draft cleared, comment at the **bottom**, both lines intact. |
| Watch the other browser | It arrives without a refresh. |
| Edit your own comment | Marked "edited" afterwards. |
| Look at someone else's | No edit or delete on it. |
| Delete yours | Confirms first. |
| Stop the API and send | The draft survives. |
| Check the card face | Comment count appears. A card with none shows nothing rather than a zero. |

---

## 7. Filtering

| Do | Expect |
|---|---|
| Press **/** anywhere on the board | Search focuses. |
| Press **/** while typing in a card title | Nothing — the slash goes into the title. |
| Search a word in a card's *description* only | It matches. |
| People → your own row is first; Labels, Priority → multi-select | The menu stays open across picks; each row shows its own state. |
| Due date | Radios, not checkboxes. "This week" includes overdue and today. |
| Anything active | A chip row names every criterion, each removable, plus "n of m" and Clear all. |
| A column whose cards are all hidden | Says how many the filter is hiding — not "empty". |
| **Drag a card between columns while filtered** | It lands where you dropped it. **Why:** the server ranks against real neighbours, not visible ones. This is the check most likely to reveal a regression. |
| Copy the URL while filtered, open in the other browser | The same filter is applied. |
| Press Back | Leaves the board. It does not undo the filter one keystroke at a time. |

---

## 8. Columns and board settings

| Do | Expect |
|---|---|
| Column `⋯` → Rename, Set card limits, Delete | All three always visible — no hovering to find them. |
| Set a max below the current count | Lane and count turn red, and the breach is stated in words. |
| Set a min above the count | Amber. |
| Set max exactly equal to the count | Nothing lights up. |
| Move a card into a full column | **It is allowed.** A limit is a signal, not a rule. |
| `⋯` beside the board name → Board settings | Every column listed with its limits side by side. |
| Move a column up, then down | Order changes on the board, and in the other browser. |
| Move the last column down | Disabled. |
| Set a minimum above an existing maximum | Refused, and the numbers are not silently swapped. |
| Blur a limit field without changing it | No request. |

---

## 9. Navigation

| Do | Expect |
|---|---|
| Sidebar | Workspace, board list with the current one marked, Members. |
| Collapse it | Board widens. Each board keeps a letter tile. |
| Reload | Still collapsed. |
| Collapse in one tab | The other tab follows. |
| Board with archived boards in the workspace | They are not in the sidebar. |
| Two workspaces | A switcher appears. With one, it is plain text. |

---

## 10. Loading and slow starts

| Do | Expect |
|---|---|
| Hard-reload a board | The skeleton's header and filter bar occupy the same space the real ones will. Nothing shifts on arrival, and no control appears or disappears. |
| Reload against a sleeping API | After a few seconds, a note explains the wait without moving the columns. |

---

## 11. Roles and read-only

| Do | Expect |
|---|---|
| Sign in as a Viewer | No Create, no column `⋯`, no board settings, no composer. Values are text. |
| The card's `⋯` as a Viewer | Present, with Copy link only. |
| The filter bar as a Viewer | Fully usable. |

---

## 12. Live collaboration

| Do | Expect |
|---|---|
| Two browsers, same board | Cursors and presence avatars. |
| Move a card in one | Moves in the other. |
| Kill the API mid-session | Reconnecting banner; on restart the board catches up without a refresh. |
| Add a column in one while the other is on a card | Appears behind the open card. |

---

## 13. Invitations

Unchanged by v3 — the flow, the token semantics and the dead ends are all as described in
`manual-test-v2.md` §12, which is still accurate for that section alone.

---

## 14. Known gaps — not bugs

- No card key, no attachments or subtasks. Swimlanes arrived in v5 — see §15.
- Invitations are copied and sent by hand; there is no email delivery.
- Theme is per-device.
- Presence is single-instance.

---

## 15. What v5 changed

The surfaces below were reworked or newly added. Where a check in an earlier section
contradicts one here, this section is the current one.

### 15.1 The card detail is a drawer, not a modal

| # | Do | Expect |
|---|---|---|
| 15.1 | Open a card | A 548px panel slides in from the right; **the board stays visible beside it** |
| 15.2 | Read down the panel | Fields, then description, then comments — in that order |
| 15.3 | Press Escape, then reopen and press **Esc** in the header | Both close it and clear `?card=` |
| 15.4 | Use the ↑ / ↓ arrows in the header | Steps to the previous/next card **without closing** |
| 15.5 | On the first card, check ↑ | Disabled, not missing |
| 15.6 | Search to one match, then open it | Both arrows **gone** |

**Why 15.6:** stepping walks the *filtered* board. If it walked the whole board, "next"
would be a card the board is not showing, and closing the drawer would leave you looking
at a list that does not contain what you were just reading.

### 15.2 The board, dragging

| # | Do | Expect |
|---|---|---|
| 15.7 | Drag a card to another column | It lands there **immediately** and stays |
| 15.8 | Watch closely on release | No animation of the card returning to the old column first |
| 15.9 | In **By person**, drag a card down a row | Confirms, naming the card *and* the person |
| 15.10 | Cancel that confirmation after a diagonal drag | **Neither** the row nor the column change is applied |
| 15.11 | In **By label**, drag a card sideways | Moves stage, no confirmation |
| 15.12 | In **By label**, drag a card to a different label row | Nothing happens, and the target never highlights |
| 15.13 | Give a card three labels, then in **By label** grab its *first* occurrence | **That** copy lifts — not one of the others |
| 15.14 | In **By priority**, drag a card into a level nothing is in yet | The row exists and accepts it |

**Why 15.8:** this looked like the move failing and retrying. It was the drop animation
flying the overlay back to a rect that no longer meant anything.

**Why 15.13:** three occurrences once shared one drag id, so dnd-kit kept the last and
grabbing any of them lifted the bottom one.

### 15.3 Identity and the mark

| # | Do | Expect |
|---|---|---|
| 15.15 | Find one person on a card, in a **By person** row, and in the header | The **same colour** in all three |
| 15.16 | Hover a card that has an assignee | The drag grip does **not** sit on top of the avatar |
| 15.17 | Look at the sidebar mark, then the browser tab | Four triangles in a rounded square, in both |
| 15.18 | Collapse the sidebar | The chevron stays **inside** the rail, under the mark |
| 15.19 | Switch palette, then look at the mark | Its accent piece follows the palette |
| 15.20 | Open sign-in | The mark is flat/monotone on the accent panel, not the full tile |

### 15.4 Creating a card

| # | Do | Expect |
|---|---|---|
| 15.21 | Open **New card** | Roomy, ~680px, title in the display face |
| 15.22 | On a board with **no labels at all** | The Labels row is still there, offering **+ Label** |
| 15.23 | Create a label from inside the dialog | It appears, can be applied, and the created card carries it |
| 15.24 | With the label picker open, press Escape | Closes **only the picker** — the dialog and what you typed survive |

**Why 15.22:** the row used to be hidden when a board had none, so the moment you are
most likely to invent a label was the one moment offering no way to do it.

### 15.5 Colour

| # | Do | Expect |
|---|---|---|
| 15.25 | Look at any screen in light mode | The page ground is near-white, not tinted with the accent |
| 15.26 | Same in dark | Near-black, not a deep violet or navy |
| 15.27 | Compare the three palettes | They differ mainly in the **accent**; the chrome is near-neutral in all three |
| 15.28 | In **By person**, find your own row | Tinted, and the cards on it still have visible edges |

**Why 15.28:** the tint was `--surface` for one revision — the same token the cards use —
so the cards lost their ground on exactly the row you look at most.

### 15.6 Two people, two tabs

| # | Do | Expect |
|---|---|---|
| 15.29 | Open the same board as two different users | Each sees the other in presence, and the other's cursor |
| 15.30 | One moves a card | It moves on the other's board **without a reload** |
| 15.31 | **Duplicate your own tab** and move the mouse | You do **not** see a cursor with your own name on it |

**Why 15.31:** `OthersInGroup` excludes the connection that called, not the person. A
second tab is a different connection belonging to the same user.
