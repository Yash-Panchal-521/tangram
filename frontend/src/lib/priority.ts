import type { CardPriority } from "@/lib/api";

/**
 * Most urgent first, which is the order the picker offers and the order a sort
 * would use. Defined once so the board face and the detail panel cannot drift
 * into disagreeing about what "High" looks like.
 */
export const PRIORITIES: CardPriority[] = ["Highest", "High", "Medium", "Low", "Lowest"];

/**
 * Which way the chevrons point, and what colour.
 *
 * Direction carries the meaning and colour reinforces it, rather than colour
 * carrying it alone — the two urgent levels and the two relaxed ones would
 * otherwise be indistinguishable to anyone who cannot separate red from blue,
 * and this icon is often the only thing on a card face at 13px.
 */
export interface PriorityLook {
  /** Up for urgent, down for relaxed, flat for the middle. */
  direction: "up" | "flat" | "down";
  /** Doubled chevrons for the extremes, so Highest reads louder than High. */
  double: boolean;
  /** A token class, not a hex — the colours must follow the theme (S1.2). */
  className: string;
}

export const PRIORITY_LOOK: Record<CardPriority, PriorityLook> = {
  Highest: { direction: "up", double: true, className: "text-danger" },
  High: { direction: "up", double: false, className: "text-danger" },
  Medium: { direction: "flat", double: false, className: "text-warn" },
  Low: { direction: "down", double: false, className: "text-text-muted" },
  Lowest: { direction: "down", double: true, className: "text-text-muted" },
};

/** True when this level is worth showing on the card face without being opened. */
export function isNotable(priority: CardPriority | null): boolean {
  return priority === "Highest" || priority === "High";
}

/**
 * How a level reads on a card face: a word, and a colour on the card's edge.
 *
 * The v7 face states the level rather than drawing it. `PRIORITY_LOOK` above is
 * still what the picker and the detail panel use, where an icon sits beside a
 * written label anyway — here the word *is* the label, so Highest and High stay
 * distinct even though they share a colour, which two shades of red at 9.5px
 * would not manage.
 *
 * The tick is a 3px edge rather than another badge because the card already
 * carries a badge; a second one competes with the first for the same glance,
 * and an edge is readable in peripheral vision down a column of cards.
 */
export interface PriorityFace {
  /** Token classes for the badge fill and its text. */
  badge: string;
  /** The card's leading edge. A CSS colour, since it is set as a border. */
  tick: string;
}

export const PRIORITY_FACE: Record<CardPriority, PriorityFace> = {
  Highest: { badge: "bg-danger-soft text-danger", tick: "var(--danger)" },
  High: { badge: "bg-danger-soft text-danger", tick: "var(--danger)" },
  Medium: { badge: "bg-warn-soft text-warn", tick: "var(--warn)" },
  Low: { badge: "bg-surface-2 text-text-muted", tick: "var(--border-2)" },
  Lowest: { badge: "bg-surface-2 text-text-muted", tick: "var(--border-2)" },
};

/**
 * The edge for a card with no priority set.
 *
 * `transparent`, not the border colour: the 3px strip is always in the layout
 * so that setting a priority does not shift the card's text sideways by three
 * pixels, but an unset card should look like it has no strip at all.
 */
export const NO_PRIORITY_TICK = "transparent";
