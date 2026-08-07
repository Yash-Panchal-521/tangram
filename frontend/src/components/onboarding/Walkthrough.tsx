"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spotlight, anchoredPosition, useAnchorRect } from "@/components/onboarding/Spotlight";
import { useDialog } from "@/lib/useDialog";
import { useSequence } from "@/lib/useSequence";

export type TourStep = {
  /** CSS selector for the element to spotlight. */
  target: string;
  title: string;
  body: string;
};

const PANEL = { width: 320, height: 168 };

/**
 * Selects the steps whose anchors are actually on the page.
 *
 * A tour is written against a layout, and this one runs on a board whose
 * contents vary — no cards yet, no second column, a viewer with no add button.
 * Filtering up front is what stops a step from spotlighting nothing and reading
 * as a broken feature.
 */
export function availableSteps(steps: TourStep[], root: ParentNode = document): TourStep[] {
  return steps.filter((step) => root.querySelector(step.target) !== null);
}

export function Walkthrough({ steps, onFinish }: { steps: TourStep[]; onFinish: () => void }) {
  const [live, setLive] = useState<TourStep[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const found = availableSteps(steps);
    if (found.length === 0) onFinish();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setLive(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every hold is null: this tour is driven entirely by the user. Same hook as
  // the self-playing introduction, different clock.
  const holds = live ? live.map(() => null) : [null];
  const { index, isLast, next, goTo } = useSequence({ holds, active: live !== null });

  const step = live?.[index] ?? null;
  const rect = useAnchorRect(step?.target ?? null);

  useDialog({ containerRef: panelRef, onClose: onFinish });

  if (!live || !step) return null;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const position = rect
    ? anchoredPosition(rect, PANEL, viewport)
    : { top: viewport.height / 2 - PANEL.height / 2, left: viewport.width / 2 - PANEL.width / 2 };

  return (
    <>
      <Spotlight rect={rect} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Walkthrough, step ${index + 1} of ${live.length}`}
        style={{ top: position.top, left: position.left, width: PANEL.width }}
        className="fixed z-50 rounded-xl border border-border bg-surface shadow-lg p-4 flex flex-col gap-2 animate-[fade-up_0.15s_ease-out]"
      >
        <p className="text-[13px] font-semibold">{step.title}</p>
        <p className="text-[13px] text-text-muted leading-relaxed">{step.body}</p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-text-dim tabular-nums">
            {index + 1} of {live.length}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={() => goTo(index - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={isLast ? onFinish : next}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
