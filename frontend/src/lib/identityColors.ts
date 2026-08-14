/**
 * A stable colour for a thing, so it can be recognised at a glance.
 *
 * Extracted from Avatar, which had it inline, because the v7 sidebar gives each
 * board a colour bar for exactly the same reason a person gets a coloured
 * avatar: a list of four identically-styled rows is four rows you have to read.
 *
 * S1.2 documented exception — these identify a *thing*, not a theme, so they
 * stay fixed across palettes and modes. Every entry clears 4.5:1 against white,
 * since avatar initials sit on top at 10–12px semibold.
 */
/* eslint-disable no-restricted-syntax -- see the note above: identity, not theme. */
export const IDENTITY_PALETTE = [
  "#AE3E2E",
  "#3F6B4A",
  "#3B5F92",
  "#6B4392",
  "#8A5A10",
  "#1F6B6E",
];
/* eslint-enable no-restricted-syntax */

/**
 * Deterministic, so one key keeps one colour on every render, in every list, for
 * every viewer. Previously every avatar was the same accent red, which made a
 * roster of five people five identical circles.
 */
export function identityColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return IDENTITY_PALETTE[hash % IDENTITY_PALETTE.length];
}
