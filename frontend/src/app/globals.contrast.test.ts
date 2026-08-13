import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/lib/theme";

/**
 * Every palette has to separate the surfaces that sit on each other.
 *
 * Written after all six failed the same way: `--surface-2` sat 0.7–2.4 L* from
 * `--bg` in light mode, so the board's lanes — the thing that makes a kanban
 * board legible — were invisible against the board behind them. It was found by
 * eye on one palette, then measured and found in all of them.
 *
 * CIE L* rather than WCAG contrast ratio. The ratio is built for text and is
 * almost flat at this end of the scale — every failing pair above scored between
 * 1.02 and 1.06, which does not distinguish "invisible" from "subtle". L* is
 * perceptual lightness, so the numbers mean something for two near-identical
 * greys touching along an edge.
 */
const CSS = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function lstar(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y <= 216 / 24389 ? y * (24389 / 27) : Math.cbrt(y) * 116 - 16;
}

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio — the right measure here, unlike for the surfaces above.
 * This pair is text on a background, which is exactly what the ratio is for.
 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A colour at `alpha` over an opaque backdrop, as the browser paints it.
 *
 * Needed because Tailwind's `/5` and `/40` alphas are not tokens, so nothing in
 * this file could see them. Fifteen lines, and the reason the lane bug was
 * arithmetic nobody had run rather than something a test could have told you.
 */
function composite(fg: string, bg: string, alpha: number): string {
  const parse = (h: string) =>
    [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [fr, fg_, fb] = parse(fg);
  const [br, bg_, bb] = parse(bg);
  const blend = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return (
    "#" +
    [blend(fr, br), blend(fg_, bg_), blend(fb, bb)]
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

function tokensFor(theme: string, mode: string): Record<string, string> {
  const block = new RegExp(
    `\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\]\\s*\\{([^}]*)\\}`
  ).exec(CSS);
  if (!block) throw new Error(`No block for ${theme} / ${mode}`);

  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
  );
}

/** Each pair, and how far apart it has to be to read as an edge. */
const PAIRS: [string, string, number][] = [
  // Cards against the board behind them.
  ["bg", "surface", 4],
  // The lanes against the board. The one that was broken everywhere.
  ["bg", "surface-2", 4],
  // A border has to be visible on whichever surface it sits on.
  ["surface", "border", 8],
  ["surface-2", "border", 6],
  ["bg", "border", 6],
  // The missing sixth pair, and the one the card detail is built on: its whole
  // right-hand Details column is `surface-2` inside a `surface` panel, "divided
  // by a rule and a tint". In five of six light palettes only the rule arrived.
  // The same pair carries every text input and textarea, both dialog footer
  // bands, the comment composer, the filter bar's search field and chip row, the
  // "View only" pill, and the settings dialog's column rows.
  ["surface", "surface-2", 4],
];

/**
 * Every text token, against every surface it is actually painted on.
 *
 * Nothing asserted the text ramp until this line — S1.2a measures surfaces and
 * S1.2c measured exactly one text pair, so the tokens carrying nearly every word
 * in the product were unmeasured. `--text-dim` turned out to fail on all three
 * surfaces in all twelve combinations, 2.05 to 4.04:1, and it is not decoration:
 * it painted every column's card count, five section headings, every comment
 * timestamp, Created and Updated, and every placeholder.
 *
 * WCAG ratio rather than L*, because this is text on a background — which is
 * what the ratio is for, and the reason surfaces use the other measure (S1.2a).
 */
const TEXT_ON: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-2"],
  ["text-dim", "bg"],
  ["text-dim", "surface"],
  ["text-dim", "surface-2"],
];

/**
 * Filled roles, against the foreground painted on them.
 *
 * `--accent`/`--accent-fg` was pinned by S1.2c; the other three fills were not,
 * and every one of them appears behind text. The danger button borrowed
 * `--accent-fg` — a pairing nobody chose and no test measured — and the
 * reconnecting banner put `--bg` on `--warn`, which is pale grey on amber at
 * 13px, full width, as the first thing a cold start shows.
 */
const FILLED_ROLES = ["accent", "danger", "warn", "success"] as const;

describe("palette contrast", () => {
  const modes = ["light", "dark"] as const;

  for (const { id } of THEMES) {
    for (const mode of modes) {
      for (const [a, b, min] of PAIRS) {
        it(`${id} / ${mode}: --${a} and --${b} are at least ${min} L* apart`, () => {
          const tokens = tokensFor(id, mode);
          expect(tokens[a], `--${a} missing`).toBeTruthy();
          expect(tokens[b], `--${b} missing`).toBeTruthy();

          const apart = Math.abs(lstar(tokens[a]) - lstar(tokens[b]));
          expect(Math.round(apart * 10) / 10).toBeGreaterThanOrEqual(min);
        });
      }
    }
  }

  for (const { id } of THEMES) {
    for (const mode of modes) {
      for (const [text, surface] of TEXT_ON) {
        it(`${id} / ${mode}: --${text} on --${surface} clears AA`, () => {
          const tokens = tokensFor(id, mode);
          expect(tokens[text], `--${text} missing`).toBeTruthy();
          expect(tokens[surface], `--${surface} missing`).toBeTruthy();

          expect(contrast(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  for (const { id } of THEMES) {
    for (const mode of modes) {
      for (const role of FILLED_ROLES) {
        it(`${id} / ${mode}: text on --${role} clears AA`, () => {
          // Each filled role owns its foreground. Borrowing another role's --*-fg
          // is the same mistake as the hardcoded white that broke when palettes
          // became switchable: a value defined against one background, reused on
          // a different one, correct only by luck.
          const tokens = tokensFor(id, mode);
          expect(tokens[role], `--${role} missing`).toBeTruthy();
          expect(tokens[`${role}-fg`], `--${role}-fg missing`).toBeTruthy();

          expect(contrast(tokens[role], tokens[`${role}-fg`])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  for (const { id } of THEMES) {
    for (const mode of modes) {
      it(`${id} / ${mode}: text on the accent clears AA`, () => {
        // Anything painted `bg-accent` puts `--accent-fg` on top at 13px, which
        // is normal-size text: 4.5:1.
        //
        // Written after the auth panel was found hardcoding white on the accent
        // instead of using the token. Once palettes were switchable that stopped
        // being safe — Graphite's dark accent is #ededed, where white measured
        // 1.17:1 — and measuring showed every dark palette failing between 1.17
        // and 3.45. Two palettes also failed on their own pairing, which is what
        // this pins.
        const tokens = tokensFor(id, mode);
        expect(contrast(tokens.accent, tokens["accent-fg"])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /**
   * A tinted state fill has to clear the same floor its surface did.
   *
   * The board's over/under lanes used to replace `bg-surface-2` with
   * `bg-warn/5` and `bg-danger/5`, and a five-percent tint of anything over
   * `--bg` is `--bg`. Composited, the breached lane sat 1.3-3.6 L* from the
   * board behind it against a healthy lane's 5.2-10.7 — under S1.2a's floor in
   * all twelve, and inverted, so a column in trouble read as calmer than its
   * neighbours.
   *
   * Nothing caught it because PAIRS compares raw tokens and a tint is not a
   * token. This composites first, which is what makes it a different check
   * rather than a longer list.
   */
  for (const { id } of THEMES) {
    for (const mode of modes) {
      for (const [role, alpha] of [["warn", 0.05], ["danger", 0.05]] as [string, number][]) {
        it(`${id} / ${mode}: --${role} at ${alpha * 100}% cannot carry a lane`, () => {
          const tokens = tokensFor(id, mode);
          // Over `--bg`, because the tint *replaced* the lane's surface rather
          // than sitting on top of it — which is the whole reason it vanished.
          const over = composite(tokens[role], tokens.bg, alpha);

          // Asserted the other way round from the rest of the file: this pins
          // that the *old* approach fails, so the reasoning survives even if
          // somebody reintroduces a tint thinking it looks tidier.
          const apart = Math.abs(lstar(over) - lstar(tokens.bg));
          expect(apart).toBeLessThan(4);
        });
      }
    }
  }

  it("defines every palette the picker offers, in both modes", () => {
    // The list and the stylesheet have to move together — nothing can read
    // which blocks exist at runtime, and a palette in one and not the other is
    // either a dead option or an unreachable block.
    for (const { id } of THEMES) {
      for (const mode of modes) {
        expect(() => tokensFor(id, mode)).not.toThrow();
      }
    }
  });
});
