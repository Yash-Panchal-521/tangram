# v5 prompt 1 — fix the nine findings

Paste into Claude Code with the repo open. Attach `Tangram UI Review.dc.html`.

---

Implement the nine findings in the attached design review. It is measured work, not
opinion — every number in it was taken from the running page across all twelve
palette/mode combinations, and the method is documented at the end of the document.

## Order

Not the document's order. Dependencies first, because four of these edit the same
twelve token blocks and doing them separately means measuring twice.

1. **Finding 5** — `border-bg` → `border-surface` in `PresenceAvatars.tsx`. Two minutes,
   unblocks nothing, do it first because it is free.
2. **Finding 9** — drop the infinite `sync-pulse` from the connected dot. Five minutes.
3. **Finding 8** — `Nudge` to `w-6 h-6`, `LimitInput` to `w-10 h-6`. Add **S5.7** (24×24
   minimum pointer target) to `ui-standards.md`.
4. **Finding 1** — lane state on the edge, not a `/5` fill. Add **S1.2d** (a state fill
   replacing a surface token clears 4 L* against its parent, measured after alpha
   compositing).
5. **Finding 4** — `labelChipStyle`: fill to `hue + "33"`, `color: "var(--text)"`, keep
   `borderColor: hue + "66"`. Take the one-line version, not the two-ramp version.
6. **Findings 3, 6, 7 together** — they all rewrite the same twelve blocks in
   `globals.css`. Do them as one pass.
7. **Finding 2** — the banner and the header label, riding on the `-fg` tokens finding 7
   introduces.

## How, for the token work

**Write the assertion before touching a colour.** That is what the existing surface pairs
did, and every palette failed on day one there too. The test is the oracle; tuning hex
values by eye across twelve combinations is how these defects arrived.

Four additions to `globals.contrast.test.ts`, in the order they will fail:

| Addition | Expected failures |
|---|---|
| `["surface", "surface-2", 4]` in `PAIRS` | 5 light palettes |
| Text ramp × every surface it is painted on, at 4.5:1 | ~30 across 12 combinations |
| Filled roles (`--danger`, `--warn`, `--success`) against new `-fg` tokens, at 4.5:1 | Terracotta dark |
| Composited state fills at 4 L* against their parent | all 12 |

The fourth needs a compositing helper — roughly fifteen lines — and is the one that would
have caught finding 1.

**Finding 3 has a conclusion inside it worth acting on**: the palettes carry three text
ramps and have perceptual room for two. Decide what `--text-dim` is *for* — genuinely
decorative marks only, the chevron in a closed select, the search glyph, an inactive grid
day — and move real content to `--text-muted`. The review lists the call sites. Do that
sweep deliberately in one pass, not incidentally.

## Rules to add to `docs/ui-standards.md`

The review proposes five. Write them in the file's existing voice — each rule states what
is required and why it was learned, not just the requirement:

- **S1.2d** — a state fill that replaces a surface token clears the same 4 L* floor
  against what it sits on, measured after alpha compositing.
- **S1.2e** — every text token clears 4.5:1 against every surface token it is painted on,
  per palette, per mode.
- **S1.2f** — a token chosen to match a background names the background it actually sits
  on. (`border-bg` on a `bg-surface` header is the case.)
- **S1.2g** — a data colour may identify a thing, but text painted in it still clears
  4.5:1 against its own fill.
- **S5.7** — a pointer target is at least 24×24 CSS pixels.

Numbering is a suggestion; fit it to the file.

## Constraints

- Tokens only. Raw hex fails lint. The documented exceptions are label and avatar colours.
- `cn()` has no Tailwind conflict resolution — replace class sets, never append.
- No new dependencies.
- Every change holds in all twelve combinations, asserted rather than eyeballed.

## Verify

`cd frontend && npm test && npm run lint && npm run build`, then the kitchen sink in a
browser across several palettes in both modes.

Say in the commit which rules each change engages and how, per this repo's convention.

## Out of scope

Do not restyle anything the review did not name. A revisualisation pass is coming
separately and this one is corrections only — the point is to have the guardrails in place
*before* the palettes are redrawn.
