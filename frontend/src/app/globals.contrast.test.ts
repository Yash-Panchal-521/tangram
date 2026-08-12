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
];

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
