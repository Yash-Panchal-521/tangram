# UI & UX standards

The bar for anything user-facing in Tangram. Rules are numbered so a change can cite the
ones it engages: *"meets S2.1 (skeleton holds layout), S3.2 (error names the user's next
action)"*.

These are **checkable**, not aspirational. If a rule can't be checked by reading the diff,
it doesn't belong here.

Deliberately not covered: visual taste. Spacing and type scale come from the existing
components; the design tokens in `globals.css` are the palette.

---

## S1 · Components and tokens

**S1.1 — Reuse before creating.** Check `components/ui` first. New primitives go there only
when nothing existing fits, and they are demonstrated on `/kitchen-sink` in the same change.

**S1.2 — Colour comes from tokens.** Use `bg-surface`, `text-text-muted`, `border-border`
and friends. Raw hex is allowed only where a value identifies a *thing* rather than a
theme — the per-person avatar palette and the decorative column dots — and each such use
carries a comment saying why. Lint enforces this.

**S1.2a — Tokens must actually differ, and a test says so.** Two surfaces that touch have
to be at least **4 L\*** apart, and a border at least **6–8 L\*** from whatever it sits on.
Every palette failed this the day it was written: `--surface-2` sat 0.7–2.4 L\* from `--bg`
in light mode, so the board's lanes were invisible against the board. Use CIE L\*, not the
WCAG ratio — the ratio is built for text and is almost flat here, scoring every failing
pair between 1.02 and 1.06, which cannot tell "invisible" from "subtle".
[`globals.contrast.test.ts`](../frontend/src/app/globals.contrast.test.ts) enforces it.

**S1.2b — Never paint a surface token at reduced opacity to make it subtle.** `bg-surface-2/50`
halves the separation the palette was chosen to provide; the lanes read as one flat field in
every theme despite tokens that measured fine. If a surface should be subtler, pick a subtler
token — do not dilute a correct one.

**S1.2c — Text on the accent is `--accent-fg`, never `white`.** That held while there was one
palette with a deep terracotta accent and broke the moment palettes were switchable: Graphite's
dark accent is `#ededed`, where white measured **1.17:1**. Every dark palette failed. The pair
`--accent` / `--accent-fg` must clear **4.5:1**, which the same test pins.

**S1.2d — A state fill clears the same floor its surface did.** Measured *after* alpha
compositing, against what it actually sits on. The board's over-limit and under-limit lanes
replaced `bg-surface-2` with `bg-warn/5` and `bg-danger/5`, and a five-percent tint of
anything over `--bg` is `--bg`: the breached lane sat **1.3–3.6 L\*** from the board against
a healthy lane's 5.2–10.7, failing S1.2a in all twelve combinations. The direction inverted
too — a column in trouble read as *calmer* than the ones that were fine. Put the state on the
edge, where a line at full strength can carry it. Nothing caught this because the contrast
test compares raw tokens and a tint is not a token; it now composites.

**S1.2e — Every text token clears 4.5:1 on every surface it is painted on.** Per palette, per
mode. `--text-dim` measured **2.05–4.04:1** across all thirty-six combinations — not one
passed — while carrying every column's card count, five section headings, every comment
timestamp, Created and Updated, and every placeholder. `--text-muted` failed in three more.
The ramp has room for about two tokens, not three, so `--text-dim` is now reserved for marks
nobody reads — a closed select's chevron, the search glyph, an inactive day in the date grid.
Anything that is content, including a number, is `--text-muted`.

**S1.2f — Every filled role owns its foreground.** `--accent-fg` exists because a value
defined against one background is correct on another only by luck. The danger button borrowed
it (4.28:1 in Terracotta dark) and the reconnecting banner put `--bg` on `--warn`, which is
pale grey on amber — **1.84:1** in Indigo, and the first thing a cold start shows.
`--danger-fg`, `--warn-fg` and `--success-fg` are pinned the same way `--accent-fg` is.

**S1.2g — A token chosen to match a background names the background it sits on.** The presence
avatars were ringed in `border-bg` while sitting in a `bg-surface` header — 8.25–10.45 L\*
apart in light mode, so every avatar wore a visibly darker stroke that read as a rendering
artefact rather than as separation.

**S1.2h — A data colour may identify a thing; text painted in it still clears 4.5:1.** Label
chips painted the name in the hue on a tint of the same hue: **2.15–4.49:1** for all seven
colours in all twelve combinations, at 10px, as the first text on every card face. The
documented hex exception licenses the hue as identity, not as a text colour. `LabelChip`'s own
docstring is the argument — "the colour is a second signal on top of the word, not a
replacement for it" — and the word was the part that failed.

**S1.2i — The chassis stays near-neutral: `bg`, `surface`, `surface-2` and `surface-3` under
C\* 4, borders under 6.** Measured in CIE chroma, where 0 is a flat grey. Every surface used to
be a tint of its palette's accent — the board ground at 8–11, cards at 15–21, borders up to
**28.6** — against **1.2** for GitHub Primer's muted canvas and **0.5, 0.7, 0.9, 3.6** across
Linear's four dark elevation steps. Four to twenty times more saturated than what shipping
tools use, which is the difference between chrome that reads as professional and chrome that
reads as a student project, and it is a number rather than an opinion. Each palette still takes
its hue from its own accent; it is rendered at a chroma you read as "slightly warm" instead of
as violet. Depth comes from a tonal ladder, not from saturation. Ceilings, not targets — flat
grey is fine, and a border gets a little more room because a hairline shows less of whatever
colour it has.

**S1.3 — Never append conflicting Tailwind classes.** `cn()` is a plain join with no
conflict resolution, so a second `border-*` or `px-*` is decided by stylesheet order, not
by argument order. Replace the class set outright, or branch:

```tsx
className={hasError ? "border-danger focus-within:border-danger"
                    : "border-border focus-within:border-accent"}
```

**S1.4 — Variants beat base classes.** A shared `focus-visible:border-accent` will hide an
error border exactly while the user is typing in the field. Choose the focus colour per
branch, as above.

**S1.5 — The focus ring is unlayered.** The global ring in `globals.css` outranks anything
in `@layer utilities` regardless of specificity, so a utility cannot override it. Composite
fields — where the focusable control isn't the visible box — opt the inner control out with
`data-focus-ring="none"` and put the ring on the wrapper.

---

## S2 · States

**S2.1 — Four states, every async surface.** Loading, empty, error, success. A surface that
can only render its happy path is incomplete.

**S2.2 — Skeletons hold layout.** Loading states occupy the same space as the content they
replace, so nothing shifts on arrival. See `MemberSkeleton` in `WorkspaceMembersView`.

**S2.3 — Empty states suggest the next action.** "No cards yet" is a dead end; an empty
state names what to do and offers the control to do it.

**S2.4 — Long waits explain themselves.** Anything that can exceed ~3 seconds says why and
what to expect. The free-tier API sleeps after 15 minutes and takes 30–60 seconds to wake —
that is predictable, so a bare "Loading…" that sits there is a bug, not a limitation.

**S2.5 — Success is visible but not sticky.** Confirm that something happened; clear it
afterwards so it can't be misread as fresh. Errors persist until dismissed or superseded.

---

## S3 · Error copy

**S3.1 — Never describe infrastructure.** No "Is the backend running?", no service names,
no environment detail. The user cannot act on any of it, and it is usually wrong about the
cause anyway.

**S3.2 — Name the user's next action.** "Couldn't save — check your connection and try
again" beats "Request failed". If nothing can be done, say that plainly rather than
implying effort will help.

**S3.3 — No raw protocol.** Status codes, methods, paths and stack traces never reach the
UI. `ApiError` carries them for logging; the surface renders human text.

**S3.4 — No vendor text passed through.** Firebase and ASP.NET messages are
developer-facing. Map them, as `friendlyAuthError` does.

**S3.5 — "Something went wrong" is a last resort**, reachable only when the cause is
genuinely unknown, and always paired with a retry.

**S3.6 — Failure must be visible.** A rejected mutation shows something. A silent catch is
only acceptable for genuinely inconsequential telemetry, and carries a comment justifying
it.

---

## S4 · Destructive actions

**S4.1 — Confirm through `ConfirmDialog`.** Never `window.confirm`, `window.prompt` or
`window.alert` — they are unstyleable, inconsistent, and break the theme. Lint enforces
this.

**S4.2 — State the consequence, not the act.** "Its 3 cards will be deleted too. Everyone
on the board sees this immediately, and it can't be undone" — not "Are you sure?".

**S4.3 — Name what is affected.** Include the actual column or person, so the user can tell
they picked the right one.

**S4.4 — Destructive dialogs focus Cancel**, so a reflexive Enter doesn't do the damage.

**S4.5 — Guard rules are surfaced, not discovered.** If the server will reject an action —
removing the last owner — disable the control and say why, rather than letting it fail.

---

## S5 · Keyboard and focus

**S5.1 — Every action reachable by keyboard.** If it can be clicked it can be tabbed to and
activated. Interactive elements are `<button>` or `<a>`, never a `div` with `onClick`.

**S5.2 — Focus is always visible**, via the global ring. Never remove it without replacing
it with something at least as clear.

**S5.3 — Escape closes** any dialog, popover or menu.

**S5.4 — Focus returns to the trigger** when an overlay closes.

**S5.5 — Overlays contain focus** while open.

**S5.6 — Labels for everything.** Icon-only controls carry `aria-label`; inputs are
associated with a `<label>`; toggles expose `aria-expanded` / `aria-pressed`.

**S5.7 — A pointer target is at least 24×24 CSS pixels.** WCAG 2.2 AA's figure, not the 44px
touch figure — this is a desktop app, and 24 is the number that is checkable in a diff. Column
reordering, which is the answer to "how do I move a column", shipped as a pair of 20×16px
half-arrows: the smallest targets in the product, on the control people go looking for.

---

## S6 · Motion and stability

**S6.1 — Respect `prefers-reduced-motion`.** Non-essential animation is disabled under it.

**S6.2 — No layout shift after load.** Reserve space for anything that arrives late.

**S6.3 — Motion is brief and purposeful** — entry and state transitions, ~150–250ms.
Nothing that delays a user who knows where they're going.

---

## S7 · Responsiveness and performance

**S7.1 — Optimistic where it is safe.** Prefer applying the change immediately with a
snapshot rollback on failure over blocking on a spinner. See `moveCardOptimistic` and the
rollback in `handleDragEnd`.

**S7.2 — Rollback must restore exactly.** Keep a snapshot; don't attempt an inverse
operation.

**S7.3 — Disable only the control in flight**, not the whole surface, so unrelated work
continues.

**S7.4 — Wide content scrolls inside its own container**, never the page body.

---

## S8 · Permissions

**S8.1 — Remove what a role cannot do; disable what is temporarily unavailable.** A
greyed-out button reads "not right now"; for a viewer the truth is "not you". Keep
`disabled` for transient states like a dropped connection.

**S8.2 — Explain a restricted surface.** A viewer sees a "View only" badge, so the board
reads as deliberately restricted rather than broken.

**S8.3 — The client never becomes the authority.** Server-side enforcement stays; UI gating
is presentation, and a hidden control is not security.

---

## S9 · Verification

**S9.1 — Pure logic gets a test.** Reducers, parsers, formatters and mappers extend the
Vitest suite. Rendering-only components don't need one.

**S9.2 — Claims are measured, not asserted.** Contrast ratios, memory, timings — check
them. This project has a documented history of confident claims that were wrong.

**S9.3 — Cite the rules.** A change touching UI states which of these it engages and how it
satisfies them. That is the gate in `CLAUDE.md`.
