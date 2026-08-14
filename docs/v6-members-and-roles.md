# v6 — members and roles

**Status: requirements.** Nothing is built. Derived from the product's actual capabilities
rather than from the roles that happen to exist.

## Why redefine rather than extend

`MembershipRole` is one enum — `Owner`, `Editor`, `Viewer` — on one row per
`(workspace, user)`, and it answers three unrelated questions at once. Working back from
the seventeen mutations and the read paths, the product contains eleven distinct
authorities:

| # | Capability | Concretely |
|---|---|---|
| 1 | **See** | Open the board, filter, read cards and comments |
| 2 | **Discuss** | Add a comment; edit and delete your own |
| 3 | **Progress work** | Move a card between columns |
| 4 | **Author work** | Create, edit, delete cards; assignee, priority, due date, labels on a card |
| 5 | **Shape workflow** | Create, rename, delete, reorder columns; set WIP limits |
| 6 | **Curate taxonomy** | Create, edit, delete the board's labels |
| 7 | **Moderate** | Delete someone else's comment |
| 8 | **Administer board** | Rename, archive, unarchive; manage who is on this board |
| 9 | **Create boards** | Within a workspace |
| 10 | **Administer people** | Invite, change roles, remove, read invite tokens |
| 11 | **Own workspace** | Transfer ownership, delete the workspace |

Today those bundle as Viewer `{1}`, Editor `{1,3,4,5,6}`, Owner `{everything}`. Three
things fall out of that table that no amount of extending would fix:

- **Capability 2 does not exist for anyone who cannot also restructure the board.** A
  read-only person cannot reply to a comment. `AddCommentAsync` runs through the same
  `EnsureCanMutate` as deleting a column, so "may not mutate" silently became "may not
  speak". Nothing chose that.
- **Capability 7 does not exist at all.** Nobody can remove someone else's comment.
- **Capability 8 is welded to 10.** You cannot let someone run a board without also letting
  them remove colleagues from the workspace.

## The model

Roles are named bundles of those eleven. Two scopes, because there are two scopes of
question.

### Board roles

| Role | Capabilities | Who this is |
|---|---|---|
| `Observer` | 1 | Reads progress. An exec, an adjacent team. |
| `Commenter` | 1, 2 | Reads and responds, but does not move the work. A stakeholder, a reviewer. |
| `Contributor` | 1, 2, 3, 4 | Does the work. Creates cards, moves them, comments. |
| `Manager` | 1–8 | Runs the board. Defines the workflow, curates labels, moderates, archives, manages who is on it. |

The two splits, and why each earns its place:

- **Observer / Commenter.** Reading and responding are different from restructuring. Today
  a stakeholder who wants to write one sentence must be given full card-editing to do it.
- **Contributor / Manager.** Moving your card affects one card. Deleting a column affects
  everyone's. Those should not be the same grant.

### Workspace roles

| Role | Capabilities | Board access |
|---|---|---|
| `Guest` | — | Only boards they are explicitly added to. |
| `Member` | 9 | Their **default board role**, on every board, unless a board says otherwise. |
| `Owner` | 9, 10, 11 | Implicitly `Manager` on every board. |

A `Member`'s **default board role** is stored on their membership and chosen when they are
invited. It is one of the four board roles.

### Resolving what someone can do on a board

In order; first match wins.

1. Not a member of the workspace → **no access** (404 — "not found" and "not permitted"
   stay deliberately conflated).
2. Workspace `Owner` → **Manager**.
3. An explicit board role exists → **that role**.
4. Workspace `Member` → **their default board role**.
5. Workspace `Guest` → **no access to this board**.

**The workspace role is a default, not a ceiling.** An explicit board role wins in both
directions, and that is the design: a `Member` whose default is `Observer` can be
`Contributor` on one board, and a `Contributor` by default can be `Observer` on the
sensitive one. Nobody ever receives more than was written down for them, and "what can this
person do?" is answerable from one membership row plus their explicit board rows.

### Where people come from

- **Signing up creates a workspace, and its creator is `Owner`.** Unchanged from today.
- **Whoever creates a board becomes its `Manager`**, written as an explicit board role. A
  `Member` who creates a board must be able to configure it.
- **Owners never need an explicit board row.** Rule 2 covers them, which is what stops a
  board's members locking the workspace owner out of it.

## User stories

The interesting part of a permissions feature is where it says no, so each story carries
the refusals.

### Workspace

**W1.** *As an owner, I invite someone as a Member with a default board role, so they can
start work without me configuring every board.*
- The invitation carries workspace role and, for `Member`, a default board role.
- Accepting grants exactly that. No board rows are written.

**W2.** *As an owner, I invite a contractor as a Guest, so they see nothing until I put them
on a board.*
- A Guest with no board roles sees an empty board list, with a message that says why rather
  than looking broken.
- A Guest cannot create a board.

**W3.** *As an owner, I change someone's workspace role.*
- `Member` → `Guest` removes access to every board they had by default; explicit board
  roles survive.
- `Guest` → `Member` requires choosing a default board role.
- The last owner cannot be demoted or removed. *(Existing invariant, unchanged.)*

**W4.** *As an owner, I remove someone from the workspace.*
- Their explicit board roles go with them.
- Cards assigned to them keep the assignment. *(Existing behaviour — `AssigneeId` has no
  foreign key, on purpose.)*

### Board

**B1.** *As an owner or board manager, I give someone a role on this board, so their access
here differs from everywhere else.*
- Setting a role identical to what they already have effectively is a no-op, and the UI
  says so rather than writing a redundant row.
- A board manager cannot add someone who is not in the workspace. Inviting is a workspace
  authority.

**B2.** *As an owner, I make someone Manager of a board, so they can run it without being
able to manage the workspace.*
- A manager can set board roles on that board only, and **cannot grant `Manager`**. Making
  someone a manager is an owner's decision, so the number of people who can archive a board
  or change its access stays deliberate rather than growing by delegation.
- A manager cannot invite to the workspace, read invite tokens, change workspace roles, or
  promote themselves.

**B3.** *As an owner or board manager, I remove someone's explicit role on this board.*
- A `Member` falls back to their default board role.
- A `Guest` loses access to the board.
- **A board always keeps someone who can administer it.** Workspace owners always qualify,
  so this can only bite if a workspace has no owners — which W3 already prevents. Written
  down so the reasoning survives.

### On a board

**U1.** *As an Observer or Commenter here, I see the board as read-only even though I edit
other boards.*
- Edit affordances are **removed, not disabled** (S8.1), and the explanation names the
  board rather than the workspace.
- A Commenter keeps the composer. An Observer does not, and is told that reading is what
  they have.

**U2.** *As a Commenter, I can discuss without being able to move the work.*
- Composer available; card drag, inline fields, column controls all absent.
- This is the capability that does not exist today at any role.

**U3.** *As a Manager, I can delete a comment that should not be there.*
- Confirmed first, and it names whose comment it is (S4.2).
- Capability 7, which does not exist today at any role.

**U4.** *As anyone, I can see what I may do here and where it comes from.*
- The header states the effective role.
- Where it comes from a default rather than an explicit grant, say so — "Observer here" and
  "Observer everywhere" are different facts.

### Live

**L1.** *When my role on a board changes, the open board reflects it without a reload.*
- The change broadcasts to that board's group; open clients re-render affordances.
- **The server is the enforcement, never the UI.** A client that missed the broadcast still
  has its next mutation rejected, because scope and role are re-derived per request.

**L2.** *When I lose access to a board I have open, I am told rather than silently broken.*
- The next action fails with an explanation, or the board closes with a message. Silent
  failure is what happens if nothing is built here, and it is the worst option.

## Invariants

- **A workspace always keeps at least one owner.** *(Existing.)*
- **Effective role is computed in exactly one place**, server-side, by the order above. A
  second implementation is how the UI and the API begin to disagree.
- **Workspace role is a default, never a ceiling.**
- **A board manager cannot reach workspace authority.**
- **Owners are implicitly managers everywhere** and never depend on a board row.
- **Tenant scope and role stay per-request.** Board roles resolve inside the same
  request-scoped service that already carries workspace roles — never cached across
  requests, which is what stops a removed member acting on a long-lived connection.

## Migration

| Today | Becomes | Effect |
|---|---|---|
| `Owner` | Workspace `Owner` | Identical |
| `Viewer` | Workspace `Member`, default `Observer` | Identical |
| `Editor` | Workspace `Member`, default `Manager` | **Gains capability 8** |

**The Editor row is the one place migration changes something, and it needs a decision.**
Today's Editor can shape the workflow and curate labels — capabilities 5 and 6 — which in
the new model belong to `Manager`. Mapping Editor to `Contributor` would take those away
and break work people do now; mapping to `Manager` preserves everything and additionally
grants board administration (rename, archive, manage board roles), which Editors did not
have.

Preserving existing ability is the safer default, so the table maps to `Manager` and the
release notes should say that existing Editors can now archive boards and manage board
membership, and that owners may want to review. The alternative — a one-off `Contributor`
mapping with a migration note — loses capability for real users and is worse.

**The property to assert in a test**, not merely to believe: after migration, every
existing user's effective capability set on every board is a superset of what it was.

## Staging

**Stage 1 — permission.** Workspace `Owner`/`Member` with a default board role, the four
board roles, and explicit board roles that override the default. Everyone in a workspace
still sees every board. This costs **zero extra database round trips**: the entity loaders
already join through to `Board` to fetch the workspace, so the board role rides the same
projection and the census budgets do not move.

**Stage 2 — visibility.** Add `Guest`, and boards a person cannot see. This changes the EF
global query filter from workspace-scoped to board-scoped — the mechanism that makes a
non-member get 404 before any role check runs. It is the load-bearing piece of tenant
isolation and deserves its own slice, its own tests, and a deliberate look at what the
`operations` log and SignalR group membership do when access is revoked mid-session.

Stage 1 answers "Editor on Hiring, Observer on Procurement". Only stage 2 gives a board
that some people cannot see at all.

## Still open

1. ~~Is `Guest` in v6?~~ **Decided: yes.** Both stages are in scope, so v6 changes the EF
   global query filter. That is the largest and riskiest part of this slice and should be
   built and tested on its own, after stage 1 is green.
2. ~~Can a board manager grant `Manager`?~~ **Decided: no.** Only workspace owners create
   managers. See the migration note below — this decision is what makes the Editor mapping
   a real question rather than a formality.
3. ~~Does moderation belong to `Manager`?~~ **Decided: yes.** Capability 7 is a manager
   power. It is new; nobody can delete another person's comment today.

**Still genuinely open — where capabilities 5 and 6 sit.** Decision 2 means `Manager` is a
scarce, owner-granted role, and a migration that turns every existing Editor into a Manager
contradicts that on day one. The alternative is to move **5 (shape workflow)** and
**6 (curate taxonomy)** down to `Contributor`, which makes `Editor -> Contributor` exactly
lossless and leaves `Manager` as pure board administration: moderate, rename, archive,
manage board roles.

That costs the original argument for the split — moving one card versus deleting a column
that holds everyone's — but it buys a coherent model and an honest migration. Trello lets
any member add lists; Jira reserves board configuration for administrators. Both are
defensible; only one of them lets this migration take nothing away.
4. ~~Where is board membership managed in the UI?~~ **Decided: the board settings dialog.**
   The members page stays canonical for *workspace* membership — who is in the organisation
   and what their default is. Board settings is canonical for *this board's* access. One
   concept per surface. UI to be designed separately.
