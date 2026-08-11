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
