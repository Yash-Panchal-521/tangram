"use client";

import { useEffect, useState } from "react";

export type Rect = { top: number; left: number; width: number; height: number };

const PADDING = 6;

/**
 * Tracks an element's position in viewport coordinates, re-measuring on scroll
 * and resize. Returns null while the element is absent, which is how a step
 * whose anchor doesn't exist gets skipped rather than pointing at nothing.
 */
export function useAnchorRect(selector: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!selector) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      return;
    }

    function measure() {
      const el = document.querySelector(selector!);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    measure();
    // `true` captures scrolls inside the board's own overflow containers, not
    // just the window's -- the columns scroll independently, and a spotlight
    // that only followed window scroll would drift off its target.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [selector]);

  return rect;
}

/**
 * Dims everything except one rectangle.
 *
 * The cut-out is an enormous outward box-shadow rather than four separate
 * panels or an SVG mask: one element, no seams between panels to line up, and
 * it moves as a unit when the target does.
 */
export function Spotlight({ rect }: { rect: Rect | null }) {
  if (!rect) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed z-40 rounded-lg pointer-events-none transition-all duration-200 ease-out"
      style={{
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
      }}
    />
  );
}

/**
 * Places a panel beside the spotlit rectangle, flipping above the target when
 * there isn't room below. Clamped to the viewport on both axes so a step
 * anchored near an edge stays readable instead of half off-screen.
 */
export function anchoredPosition(
  rect: Rect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 14
): { top: number; left: number } {
  const below = rect.top + rect.height + gap;
  const fitsBelow = below + panel.height <= viewport.height;

  const top = fitsBelow ? below : Math.max(gap, rect.top - gap - panel.height);
  const left = Math.min(
    Math.max(gap, rect.left + rect.width / 2 - panel.width / 2),
    Math.max(gap, viewport.width - panel.width - gap)
  );

  return { top, left };
}
