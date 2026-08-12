# Manual test pass — the app as it stands

Supersedes `manual-test-v2.md`, which described the board before v3 reworked it:
per-column add buttons, no filters, no sidebar, no settings panel, no themes. Roughly
half its checks referred to controls that no longer exist.

Each check is **Do → Expect**. Where a wrong result would still look plausible, there is a
**Why** line — those are the ones worth reading before you click.

**Read this before starting.** Everything behind sign-in in v3 was built and verified by
automated test rather than by eye, because the tooling used could not enter a password. The
suites pass. They also passed while the board's lanes were invisible in every palette, while
white text sat on a near-white panel, and while column moves returned 500. **This document is
the part that was missing**, so treat §1 and §12 as the highest-value sections rather than
formalities.

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

- No card key, no swimlanes, no attachments or subtasks.
- Invitations are copied and sent by hand; there is no email delivery.
- Theme is per-device.
- Presence is single-instance.
