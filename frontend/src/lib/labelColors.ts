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
    // Low alpha so the chip reads as a tint in light mode and doesn't glare in
    // dark; the hue itself carries in the text and border.
    backgroundColor: `${hue}22`,
    borderColor: `${hue}66`,
    color: hue,
  };
}

/** The solid swatch used by the colour picker, where there is no text to carry it. */
export function labelSwatchStyle(color: LabelColor): React.CSSProperties {
  return { backgroundColor: HUE[color] ?? HUE.grey };
}
