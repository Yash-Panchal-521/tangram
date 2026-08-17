# v5 prompt 2 — revisualise the whole product

> **Done.** See the note on [`v5-prompt-1-findings.md`](v5-prompt-1-findings.md).

For Claude with the project attached, **and** the deployed URL open:
<https://tangram-mu.vercel.app>. Run this *after* prompt 1, so the contrast tests exist
before any palette is drawn.

---

You are the design lead for Tangram's visual redesign. Not a review this time — a
direction.

## The brief, honestly stated

Tangram is a multi-tenant real-time collaborative kanban board. Next.js 16, React 19,
Tailwind v4, hand-built primitives, no component library. It works, it is accessible, and
**it is forgettable.** Every surface is competent and none of it is memorable. Somebody
looking at it for thirty seconds has no reason to remember it an hour later.

That is the problem to solve. Not polish — a point of view.

A previous pass rebuilt the board view and the result was indistinguishable from what
already existed. Do not do that. If your proposal could be described as "the same thing
with better spacing", it has failed.

## The constraint that is probably causing it

The app currently ships **six switchable palettes × light and dark = twelve combinations**:
Terracotta, Slate, Graphite, Forest, Midnight, Indigo. Every one must be a neutral chassis
with a single accent slot, because a design that has to hold in all six cannot let colour
do anything structural.

I think that is why it looks generic, and I want you to address it head-on rather than
design around it. Argue for one:

- **Keep six.** Then the distinctiveness must come entirely from form — typography,
  density, rhythm, motion, shape language, layout — and you should say so explicitly and
  go much harder on those than the current design does.
- **Cut to two or three opinionated palettes.** Then colour relationships become available
  and each palette can have a real character. Say what is lost: people liked choosing.
- **One signature palette, plus light/dark.** Maximum distinctiveness, minimum choice.

Whichever you pick, defend it in a paragraph. This is the load-bearing decision in the
whole redesign and everything else follows from it.

## What "impressive" has to mean here

Not decoration. Specifically **not**: glassmorphism, gradient meshes, neon glows, animated
blobs, drop shadows on everything, or a dark theme with a purple accent. Those read as
2021 template and they will make a real tool look like a landing page.

What I am asking for is a product with a *thesis* — the way Linear's density and keyboard
primacy are a thesis, Things' typography is a thesis, Figma's canvas chrome is a thesis.
Something a designer could describe in one sentence and recognise from a screenshot with
the logo cropped out.

Name your references explicitly. Say what you are taking and what you are deliberately not.

## Cover the whole product

The last pass did the board only. These are all of the surfaces, and the ones after the
board are the ones nobody has designed:

**Signed in**
- Board — columns, cards, filter bar, header, presence
- Card detail modal — two columns, description, comments, context panel
- Dialogs — create card, seed columns, board settings, column limits, confirms
- Sidebar — workspace switcher, board list, collapsed state
- Workspace home (`/boards`)
- Members roster and the invite flow
- Empty, loading, error and read-only states for all of the above

**Signed out**
- Login, sign-up, the invitation accept/decline page
- The welcome and first-run flow

**Also**
- The kitchen sink at `/kitchen-sink`, which is where every primitive lives

## Hard constraints — a proposal that breaks these cannot be built

- **Design tokens only.** Raw hex fails lint. You may define *new* tokens freely — that is
  expected — but every colour must be one.
- **No component library.** shadcn, Radix and MUI are not available answers. Primitives are
  hand-built in `components/ui/`.
- **`cn()` has no Tailwind conflict resolution.** Variants must be whole class sets.
- **Tailwind v4, CSS-first.** No config file; `@theme inline` in `globals.css`.
- **Accessibility is not negotiable.** `docs/ui-standards.md` and
  `globals.contrast.test.ts` are enforced in CI. Every palette you propose must clear the
  assertions — surfaces 4 L* apart, text 4.5:1 on every surface it lands on, filled roles
  paired with their own foreground. Give me the measured numbers, not an assurance.
- **No new runtime dependencies** unless a finding is impossible without one, and say so.
- A **web font is allowed** if it earns its place — say which, why, and what it costs in
  bytes and in first paint.

## What is deliberately absent and stays absent

Card keys, swimlanes, attachments, subtasks, issue types, story points, undo. Do not
propose features. This is a visual and interaction redesign of what exists.

## What I want back

1. **The thesis.** One sentence, then a paragraph defending it.
2. **The palette decision** from the three options above, argued.
3. **The system**, concretely enough to implement:
   - Type scale — family, sizes, weights, line heights, and what each step is for
   - Spacing scale and the grid the layouts sit on
   - Shape language — radii, borders, elevation, and when each applies
   - Colour tokens per palette per mode, **with measured contrast for every pair the
     tests assert**
   - Motion vocabulary — durations, easings, what animates and what must not.
     Current rule: 150–250ms, entry and state transitions only. Change it if your thesis
     needs it, but say so and say why.
4. **Per surface, from the list above**: what changes, what it becomes, and why. The board
   and the card modal in most detail; the others at least a paragraph each.
5. **The migration** — what order to build it in, what breaks, and which of the existing
   `ui-standards.md` rules your direction invalidates or needs rewritten.
6. **What you kept.** The review before this named three things worth protecting: the
   filter chip row, the fixed-height modal with two scroll areas, and per-field save with
   per-field failure. If your direction changes any of them, justify it specifically.

## What I do not want

- Mockup images I cannot implement. Describe in tokens, classes and structure.
- A moodboard, or adjectives without values. "Refined and modern" is not a specification;
  `14px/20px, 500, -0.01em` is.
- A proposal that only works in one palette or only in dark mode.
- Anything that would fail the contrast tests. Check before proposing.
- Hedging. Pick a direction and defend it. If I disagree I will say so.
