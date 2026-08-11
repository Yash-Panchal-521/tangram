# Manual test pass — everything after the MVP

Covers every commit from `459dbc5` onwards: v2 phase 1 (scopes A–C6), phase 2
(features 1–3), the welcome flow, the invitation flow, and four defects found by
using the app rather than testing it.

Each check is **Do → Expect**. Where a wrong result would still look plausible,
there's a **Why** line — those are the ones worth reading before you click.

Nothing here is covered by the automated suites in a way that makes it redundant:
401 backend + frontend tests pass and still missed the four defects in §14.

## Setup

```bash
docker start tangram-pg
```

Backend, in `backend/src/Tangram.Api`:

```bash
dotnet run --no-launch-profile --urls http://localhost:5400
```

Frontend, in `frontend`:

```bash
npm run dev
```

`frontend/.env.local` must have `NEXT_PUBLIC_API_BASE_URL=http://localhost:5400`
and no trailing slash.

You need **two accounts** and ideally **two browsers** (or one plus a private
window) — §11 and §12 are about two people seeing each other.

> **Fresh start:** several checks are once-per-account (welcome, board intro).
> To redo them, sign up a new account — or clear `board-intro:{uid}` from
> localStorage for that one.

---

## 1. Sign-up and the welcome flow

New account, in a browser where you've never signed up.

| # | Do | Expect |
|---|---|---|
| 1.1 | Load `/signup` | Form appears — not a "checking session" flash |
| 1.2 | Sign up with a real name | Lands on `/welcome`, **not** straight on a board |
| 1.3 | Look at the workspace field | Pre-filled *"{FirstName}'s workspace"* — not "My Workspace" |
| 1.4 | Look at the templates | Three options, each **listing the columns it produces** |
| 1.5 | Pick Sprint | Shows `Backlog · In Progress · Review · Done` |
| 1.6 | Type an invalid address in the invite box | Warns it will be skipped — does **not** block the button |
| 1.7 | Press **Create my board** | Board opens with the Sprint columns in that order |
| 1.8 | Sign up a second account, press **Skip** immediately | Board with To Do / In Progress / Done |

**Why 1.8:** Skip must produce exactly what the old automatic bootstrap
produced. If Skip errors or leaves you without a board, the escape hatch is
broken and the whole screen becomes mandatory.

| # | Do | Expect |
|---|---|---|
| 1.9 | Sign in again later | Goes to your board — never back to `/welcome` |
| 1.10 | Check the display name top-right | Your real name, **not** the email local-part |

**Why 1.10:** Firebase mints the ID token before the profile is set. If the
redirect races it, the backend names you after your email forever.

---

## 2. First-run board introduction

Only on a board with columns and **no cards**, once per account per browser.

| # | Do | Expect |
|---|---|---|
| 2.1 | Land on a brand-new board | A phantom teammate's cursor adds a card and drags it to the next column |
| 2.2 | Watch it finish | A panel explains what you just saw |
| 2.3 | Press **Skip** — it's there from the first frame | Introduction stops immediately |
| 2.4 | Reload mid-animation | No leftover card. Board is genuinely empty |
| 2.5 | Reload after it finished | Doesn't play again |
| 2.6 | **Sign up a second account in the same browser** | It **plays for them too** |

**Why 2.6:** this is defect fix `94dbf2b`. Seen-state used to be keyed per
browser, so the second person to sign up in a browser got nothing — which is
exactly how this project gets demonstrated.

| # | Do | Expect |
|---|---|---|
| 2.7 | Turn on OS "reduce motion", new account | Jumps straight to the closing panel, no animation |
| 2.8 | As a Viewer (see §11), open an empty board | Introduction does **not** play |
| 2.9 | Let it finish | The first column's add-card form is already open |

---

## 3. Board view — empty states, pending, drag

| # | Do | Expect |
|---|---|---|
| 3.1 | Empty column | Names itself as a drop target — not blank space |
| 3.2 | Board with no columns at all | A real empty state, not one dashed button in the corner |
| 3.3 | Add a card | A dashed **"Adding…"** placeholder, then the real card |
| 3.4 | Add a column | Same pending treatment |
| 3.5 | Drag a card to another column | Drops cleanly; order holds after reload |
| 3.6 | Drag a card onto an empty column | Accepts it |

**Why 3.3:** creates can't be optimistic — the server assigns the id and the
rank. A card that appears instantly with real styling means someone invented a
temporary id, and you'll get a duplicate when the broadcast lands.

---

## 4. Card detail panel

| # | Do | Expect |
|---|---|---|
| 4.1 | Open a card, edit the title, press Escape | Asks before discarding |
| 4.2 | Same, but click the ✕ | Asks — same guard |
| 4.3 | Same, but click the overlay | Asks — same guard |
| 4.4 | With the confirmation open, press Escape | Dismisses **only the confirmation**, panel stays, edit survives |
| 4.5 | Edit something | An **"Unsaved"** marker appears |
| 4.6 | Press Cmd/Ctrl + Enter | Saves |
| 4.7 | Press plain Enter in the title | Does **not** save |
| 4.8 | Delete a card | Confirms first, **naming the card** |

**Why 4.4:** both the panel and the confirmation listen on `document`. A single
Escape used to close both — discarding the exact edit the confirmation existed to
protect.

**Why 4.3:** guarding only some exits is worse than guarding none. You learn to
trust it, then lose an edit through the one that was missed.

---

## 5. Due dates and assignees

| # | Do | Expect |
|---|---|---|
| 5.1 | Set a due date | Shows on the card |
| 5.2 | Set it to today | Reads as due today — not yesterday |
| 5.3 | Assign to a workspace member | Their name/avatar appears |
| 5.4 | Change title **and** due date, save once | One entry in the activity feed, not three |
| 5.5 | Clear the due date | Actually clears, and stays cleared after reload |
| 5.6 | Edit only the title | Due date and assignee **survive untouched** |

**Why 5.6:** JSON can't tell "absent" from "null". Without explicit clear flags,
an edit that only changed the title wipes everything it didn't mention.

**Why 5.2:** a due date is a day, not a moment. If it reads back through your
local timezone, cards start claiming they were due yesterday.

---

## 6. Keyboard and accessibility

| # | Do | Expect |
|---|---|---|
| 6.1 | Tab through the board | Everything interactive is reachable |
| 6.2 | Open the card panel, hold Tab | Focus stays **inside** the panel |
| 6.3 | Close it | Focus returns to the card you opened |
| 6.4 | Tab to a card, press **Space** | Picks it up for dragging |
| 6.5 | Arrow keys, then **Space** | Drops it there |
| 6.6 | Pick up a card, press **Escape** | Cancels the drag, card returns |
| 6.7 | Type in a dialog field | Caret **stays put** — doesn't jump to the top |

**Why 6.7:** the focus trap re-runs on every render. If `onClose` isn't held in a
ref, initial focus re-fires on every keystroke.

---

## 7. Loading states

| # | Do | Expect |
|---|---|---|
| 7.1 | Hard-reload a board | A board-shaped skeleton — not a spinner, not blank |
| 7.2 | Compare skeleton to loaded board | Same silhouette, **no layout jump** |
| 7.3 | Throttle to Slow 3G, reload | Skeleton, then content; no flash of the wrong thing |
| 7.4 | Reload `/boards` | Skeleton holds the layout |

---

## 8. Error states

Stop the backend (Ctrl+C) and try things.

| # | Do | Expect |
|---|---|---|
| 8.1 | Add a card | A visible, human error — **not** silence |
| 8.2 | Read it | No status codes, no URLs, no stack traces |
| 8.3 | Look for a retry | Offered — this one is retryable |
| 8.4 | Rename a column | Also reports failure |
| 8.5 | Delete a column | Also reports failure |
| 8.6 | Drag a card | Rolls back **and says so** |
| 8.7 | Restart the backend, retry | Works |

**Why 8.1:** before this, all seven board mutations had no `catch` at all. A
rejected request went nowhere — the change just didn't happen.

| # | Do | Expect |
|---|---|---|
| 8.8 | As a Viewer, try to force an edit | Error names what you can do, and offers **no** retry |
| 8.9 | Owner tries to demote the last owner | Repeats the server's rule verbatim |

---

## 9. Activity feed and undo

| # | Do | Expect |
|---|---|---|
| 9.1 | Open the activity panel | Who changed what, newest first |
| 9.2 | Add a card, check the feed | Names the card |
| 9.3 | Press **Ctrl+Z** | Undoes your last change |
| 9.4 | Check the feed | Reads **"undid adding *Card name*"** — not "deleted a card" |
| 9.5 | Delete a column with cards in it, then Ctrl+Z | Column **and all its cards** come back |
| 9.6 | Press Ctrl+Z again | Does **not** redo — undos aren't undoable |
| 9.7 | Have the other account make a change, then press Ctrl+Z | Undoes **your** last change, not theirs |
| 9.8 | Rename a card, Ctrl+Z | The **old** title returns |

**Why 9.5:** the DB cascade takes the cards and the payload holds only the column
id. Without a snapshot, undo restores an empty column and silently loses the work
— the exact deletion people most want back.

**Why 9.8:** payloads record the state an operation *produced*, never what it
replaced. If the inverse isn't captured before the write, the old title is gone
forever.

**Why 9.4:** defect fix `831c14d`.

### The one that could destroy a board

| # | Do | Expect |
|---|---|---|
| 9.9 | Brand-new board. Open the feed **before touching anything** | **Empty.** No "added a column" entries |
| 9.10 | Press Ctrl+Z three times on that untouched board | Nothing happens. Columns stay |

**Why:** the three starter columns used to be created by ordinary API calls
carrying your token, so the log recorded them as *your* work. Three presses of
Ctrl+Z stripped a brand-new board to nothing, with no way back — a new user's
first interaction could irreversibly destroy their board. Seeding now happens
inside the board-create transaction with no operations rows. **Board `seq` must
still be 0** on a fresh board.

---

## 10. Workspaces and boards

| # | Do | Expect |
|---|---|---|
| 10.1 | Open `/boards` | Every workspace you belong to, your role in each, boards inside |
| 10.2 | Create a second board | Appears; both reachable |
| 10.3 | Rename a board | Sticks after reload |
| 10.4 | Archive a board | Filed behind a disclosure — **not** vanished |
| 10.5 | Expand the disclosure, unarchive | Comes back with its cards intact |
| 10.6 | Open an archived board by URL | Still loads |
| 10.7 | Try to archive the workspace's **last** active board | Refused, with a reason |
| 10.8 | As an Editor, try to archive | Control **absent**, not disabled |

**Why 10.7:** otherwise the home screen offers only "create a board", with no
route back to the work that was there.

**Why 10.4:** a board holds everything anyone wrote on it. A board that vanished
from the listing reads as data loss.

---

## 11. Roles and read-only

Needs the second account in the workspace (do §12 first, or invite them).

| # | Do | Expect |
|---|---|---|
| 11.1 | Set the second account to **Viewer** | Their board reloads read-only |
| 11.2 | As the Viewer, look for add/edit controls | **Removed**, not greyed out |
| 11.3 | As the Viewer, open a card | Title and Description are plain text |
| 11.4 | Look at Due and Assignee on that card | Plain text too: *"No due date."* / *"Unassigned."* |
| 11.5 | Look for an empty `dd-mm-yyyy` field | There isn't one |
| 11.6 | As the Viewer, check the header | Says why it's read-only |
| 11.7 | As the Viewer, open the activity feed | Readable |
| 11.8 | Promote to Editor | Controls appear without a manual reload |
| 11.9 | Try to demote the only owner | Control disabled, rule explained |

**Why 11.4–11.5:** defect fix `831c14d`. Title and Description degraded to text
but Due and Assignee stayed as a *disabled* date picker and dropdown —
editable-looking chrome nobody could operate. 226 automated tests missed it.

---

## 12. Invitations — the main event

Two browsers. Owner in one, invitee in the other.

### 12a. Sending

| # | Do | Expect |
|---|---|---|
| 12.1 | As owner, Members → invite an address with **no account** | Row appears under Pending |
| 12.2 | Read the pending row | Shows when invited **and when the link expires** |
| 12.3 | Press **Copy invite** | Message names the workspace, carries an `/invite/{token}` link |
| 12.4 | Read the message | Warns the link is a credential — anyone who opens it can join |
| 12.5 | Inspect the link | Contains a token. **No email anywhere in it** |
| 12.6 | Invite an address that **already has an account** | Joins immediately (see §15) |
| 12.7 | Invite several at once, mixed roles | Each invited at the role on its chip |
| 12.8 | Invite a nonsense address | Flagged before you can send |

**Why 12.5:** an address in a URL lands in browser history, Referer headers and
every access log the link passes through, and travels with each forward.

### 12b. Accepting — no account yet

| # | Do | Expect |
|---|---|---|
| 12.9 | Open the link in a **signed-out** browser | Goes **straight to sign-up** — no interstitial |
| 12.10 | Look at the banner | *"Joining {workspace} as {role}, invited by {name}"* + what the role means |
| 12.11 | Look at the email field | **Pre-filled** with the invited address |
| 12.12 | Look at the URL | `/signup?invite={token}` — **no email in it** |
| 12.13 | Complete sign-up | Lands **on the board**, already a member |
| 12.14 | Confirm you did **not** pass through `/welcome` | Correct — you joined a workspace, you don't need setup |
| 12.15 | Owner refreshes Members | The person has moved from Pending to Members |

**Why 12.14:** `/welcome` decides by asking "do you have a board?". Reaching it
before the accept lands would offer to build a workspace to someone who just
joined one.

### 12c. Accepting — already signed in

| # | Do | Expect |
|---|---|---|
| 12.16 | Signed in as someone else, open a fresh invite link | **Asks** — Accept / Decline |
| 12.17 | Read the small print | *"Joining as {your email}"* + "Use a different account" |
| 12.18 | Press Accept | *"You're in"* — states the workspace, role **and account** |
| 12.19 | Confirm it did **not** silently redirect | Correct |
| 12.20 | Click **Open the board** | The joined board |

**Why 12.16–12.19:** the link isn't bound to an address, so whichever account is
signed in is the one that joins — and there is no "leave workspace", so a wrong
join isn't self-undoable.

### 12d. Declining

| # | Do | Expect |
|---|---|---|
| 12.21 | Fresh link, **signed out**, press "Decline this invitation" on the sign-up banner | Works — **no account required** |
| 12.22 | Where you land | *"Turned down"* |
| 12.23 | Reopen the same link | Says it was turned down. No Accept button |
| 12.24 | Owner checks Members | Still listed under Pending — they can re-invite or revoke |
| 12.25 | Signed in, press Decline | Same outcome, no redirect |

**Why 12.21:** requiring an account to refuse means creating one to say no.

### 12e. Dead ends

| # | Do | Expect |
|---|---|---|
| 12.26 | Open `/invite/total-nonsense` | *"That link doesn't work"* + "ask whoever invited you" |
| 12.27 | Look for a retry there | **None** — retrying a 404 fails again by definition |
| 12.28 | Signed out, press "Go back" | → sign in |
| 12.29 | Signed in, press "Go back" | → your boards |
| 12.30 | Accept a link **twice** (second browser) | Second attempt refused |
| 12.31 | Owner revokes a pending invite, then open its link | Dead |
| 12.32 | Owner re-invites the same address | **New token**; the old link stays dead |
| 12.33 | Read the revoke confirmation | Says the link already sent will stop working |

### 12f. Token is a credential

| # | Do | Expect |
|---|---|---|
| 12.34 | As a **Viewer**, open Members | Pending invitations visible |
| 12.35 | As that Viewer, look for **Copy invite** | **Absent** — the token is owner-only |
| 12.36 | As that Viewer, check the network response for `/members` | `token` is `null` |

**Why:** a viewer holding the token could hand out membership — exactly the
authority the role withholds.

---

## 13. Live collaboration

Both browsers on the same board.

| # | Do | Expect |
|---|---|---|
| 13.1 | Add a card in one | Appears in the other, live |
| 13.2 | Drag a card in one | Moves in the other |
| 13.3 | Move your mouse | The other sees your cursor with your name |
| 13.4 | Check presence avatars | Both people shown |
| 13.5 | Open two tabs as the same person | Avatar doesn't duplicate or flicker |
| 13.6 | Kill the backend, watch | A reconnecting banner |
| 13.7 | Restart it | Reconnects and **catches up** on what it missed |
| 13.8 | Make changes in browser A while B is disconnected, then reconnect B | B shows them |

---

## 14. Walkthrough

| # | Do | Expect |
|---|---|---|
| 14.1 | Account menu → **Show me around** | Tour opens with a spotlight |
| 14.2 | Step through it | Each step highlights a real element |
| 14.3 | Check the counter | "1 of N" where **N is what you'll actually see** |
| 14.4 | Run it as a Viewer | Steps pointing at absent controls are dropped, count adjusts |
| 14.5 | Press Escape | Closes |
| 14.6 | Run on a board where nothing is spotlightable | Doesn't open empty |

---

## 15. Known gaps — not bugs

Don't file these.

- **Labels and comments** — not built. Card depth shipped due dates and
  assignees only; the other two need their own tables and lifecycle.
- **Leave workspace** — doesn't exist. Only an owner can remove a member.
- **Existing accounts skip consent.** Inviting an address that already has a
  Tangram account adds them immediately, with no accept step. And since
  declining requires signing in — which creates the account — **a decline can be
  overridden by the owner clicking Invite again.** Documented in a test rather
  than fixed; closing it means every invite goes through a link, including for
  existing users. Your call, still open.
- **Email is never verified.** Firebase treats a password sign-up as unverified,
  and nothing here reads that flag. This is *why* the token exists.
- **No email delivery.** Invitations are copy-paste by design.
- **Single instance presence.** Free-tier hosting is one instance, so the
  in-memory presence tracker is the scaling limit.

---

## Deploying, when you're happy

Five migrations are pending. **Backend first** — an API returning extra fields
won't break an old frontend, but the reverse will.

1. `git push origin main`, wait for CI green
2. Render → Manual Deploy
3. `git ship`
