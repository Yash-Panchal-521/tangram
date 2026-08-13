import type { LabelColor } from "@/lib/api";

/**
 * The palette, as Tailwind class sets rather than hex.
 *
 * The server stores a *name* — "red" — and this is where it becomes a colour.
 * Keeping it here rather than in the database is what lets the whole palette be
 * restyled at once, and is why a label's colour survives a theme change: a
 * stored hex would have been chosen against one background and then rendered
 * against another when the theme flips.
 *
 * The values are raw hex because a label's colour identifies a *thing* the user
 * picked, not a role in the theme — the same exception the avatar palette and
 * the column dots take (S1.2). Each is given at a low alpha for the chip fill
 * so it stays legible in both modes, with the text and border carrying the hue.
 */
export const LABEL_COLORS: LabelColor[] = [
  "grey",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
];

/* eslint-disable no-restricted-syntax -- see the note above: a label's colour is
   data the user chose, not a theme role. Same exception as Avatar's palette. */
const HUE: Record<LabelColor, string> = {
  grey: "#7a7a7a",
  red: "#c0392b",
  orange: "#c9702a",
  yellow: "#b8901c",
  green: "#3f8f52",
  blue: "#3a6ea8",
  purple: "#7a52a0",
};
/* eslint-enable no-restricted-syntax */

/**
 * Inline styles rather than classes: seven colours times three properties is
 * twenty-one utilities Tailwind would have to be told about statically, and the
 * values are data anyway.
 */
export function labelChipStyle(color: LabelColor): React.CSSProperties {
  const hue = HUE[color] ?? HUE.grey;
  return {
    // The hue identifies the label; it does not carry the label's name.
    //
    // This used to paint the name in `hue` on a `hue22` fill of itself, which
    // measured 2.15-4.49:1 against the composited chip across every colour in
    // every combination — worst yellow at 2.15, purple at 2.23. The chips render
    // at 10px above the card title, so that was the first and smallest text on
    // every card face, and LabelChip's own docstring is the argument against it:
    // "the colour is a second signal on top of the word, not a replacement for
    // it." The word was the part that failed.
    //
    // S1.2's data-colour exception licenses the hue as identity. It does not
    // license text painted in that hue (S1.2g). Border and fill both still carry
    // the hue, so nothing is lost from the identity; the name is simply legible.
    backgroundColor: `${hue}33`,
    borderColor: `${hue}66`,
    color: "var(--text)",
  };
}

/** The solid swatch used by the colour picker, where there is no text to carry it. */
export function labelSwatchStyle(color: LabelColor): React.CSSProperties {
  return { backgroundColor: HUE[color] ?? HUE.grey };
}
