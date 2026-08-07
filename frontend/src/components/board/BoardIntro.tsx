"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDialog } from "@/lib/useDialog";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { useSequence } from "@/lib/useSequence";

// Step 3 holds until the user acts, which is what makes it the finale rather
// than another beat in the animation.
const HOLDS = [900, 1100, 1500, null];

const STEP_CURSOR_IN = 0;
const STEP_CARD_APPEARS = 1;
const STEP_CARD_MOVES = 2;
const STEP_FINALE = 3;

const DEMO_TEAMMATE = "Sam";
const DEMO_CARD_TITLE = "Draft the launch plan";

type Anchors = { fromX: number; toX: number; y: number; width: number };

/**
 * Measures where the demonstration should happen, in the board area's own
 * coordinates.
 *
 * Measured rather than derived from the column width and gap constants: those
 * live in BoardColumn and would silently desynchronise the moment either
 * changes, leaving a ghost card floating between two columns with nothing to
 * fail loudly.
 */
function measure(container: HTMLElement): Anchors | null {
  const zones = container.querySelectorAll<HTMLElement>("[data-intro-dropzone]");
  if (zones.length < 2) return null;

  const base = container.getBoundingClientRect();
  const first = zones[0].getBoundingClientRect();
  const second = zones[1].getBoundingClientRect();

  return {
    fromX: first.left - base.left,
    toX: second.left - base.left,
    y: first.top - base.top,
    width: first.width,
  };
}

function Finale({
  onAddCard,
  onDismiss,
}: {
  onAddCard: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog({ containerRef: ref, onClose: onDismiss });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to your board"
      className="pointer-events-auto absolute left-1/2 bottom-8 -translate-x-1/2 w-[min(90vw,420px)] rounded-xl border border-border bg-surface shadow-lg p-5 flex flex-col gap-3 animate-[fade-up_0.2s_ease-out]"
    >
      <p className="text-sm font-semibold">That was someone else editing your board.</p>
      <p className="text-[13px] text-text-muted leading-relaxed">
        Everything anyone does — adding a card, dragging it, renaming a column — shows up for
        everyone else as it happens. Nothing to refresh, nothing to save.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={onAddCard}>
          Add my first card
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          I&apos;ll explore on my own
        </Button>
      </div>
    </div>
  );
}

/**
 * The first-run introduction: the board demonstrates itself.
 *
 * Deliberately not a coach-mark tour. The one thing about this app that a
 * screenshot cannot convey is that someone else's edits arrive while you watch,
 * so the introduction *shows* that instead of describing it — a phantom
 * teammate adds a card and drags it across, and then says what you just saw.
 *
 * Nothing here touches the board. The card and cursor are painted on an overlay
 * and never reach the API, so a first run leaves no rows behind and nothing to
 * clean up if the user reloads midway.
 */
export function BoardIntro({
  boardAreaRef,
  onAddCard,
  onDismiss,
}: {
  boardAreaRef: React.RefObject<HTMLElement | null>;
  onAddCard: () => void;
  onDismiss: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [anchors, setAnchors] = useState<Anchors | null>(null);

  const { index } = useSequence({
    holds: HOLDS,
    active: anchors !== null,
    skipTimers: reducedMotion,
  });

  useEffect(() => {
    const container = boardAreaRef.current;
    if (!container) return;

    function remeasure() {
      const next = measure(container!);
      // Bail out entirely rather than animate against a guess. A board whose
      // columns can't be found is one where the demonstration would land in
      // the wrong place, which is worse than not running.
      if (!next) onDismiss();
      else setAnchors(next);
    }

    remeasure();
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardAreaRef]);

  if (!anchors) return null;

  const cursorVisible = index >= STEP_CURSOR_IN && index < STEP_FINALE;
  const cardVisible = index >= STEP_CARD_APPEARS;
  const moved = index >= STEP_CARD_MOVES;
  const x = moved ? anchors.toX : anchors.fromX;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none" data-testid="board-intro">
      {/* Skip stays reachable from the first frame. An introduction you have to
          sit through is a worse first impression than no introduction. */}
      <button
        onClick={onDismiss}
        className="pointer-events-auto absolute top-3 right-4 text-[11px] font-medium text-text-dim hover:text-text underline cursor-pointer"
      >
        Skip
      </button>

      {cardVisible && (
        <div
          style={{ left: x, top: anchors.y, width: anchors.width }}
          className={`absolute rounded-[8px] border border-accent bg-surface p-3.5 shadow-md ${
            reducedMotion ? "" : "transition-[left] duration-700 ease-in-out"
          }`}
        >
          <p className="text-[13px] font-medium leading-snug">{DEMO_CARD_TITLE}</p>
        </div>
      )}

      {cursorVisible && (
        <div
          style={{ left: x + anchors.width * 0.55, top: anchors.y + 34 }}
          className={`absolute flex items-center gap-1 ${
            reducedMotion ? "" : "transition-[left] duration-700 ease-in-out"
          }`}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" fill="none" aria-hidden="true">
            <path
              d="M1 1L1 14L4.5 10.8L7 16L9.6 14.8L7.1 9.9L11.5 9.6L1 1Z"
              fill="var(--accent)"
              stroke="var(--accent-fg)"
              strokeWidth="1"
            />
          </svg>
          <span className="rounded px-1.5 py-0.5 bg-accent text-accent-fg text-[11px] font-medium whitespace-nowrap">
            {DEMO_TEAMMATE}
          </span>
        </div>
      )}

      {/* Live region rather than relying on the animation: none of the above
          exists for a screen reader, so the same story is told in words. */}
      <p role="status" className="sr-only">
        {index === STEP_CARD_APPEARS &&
          `${DEMO_TEAMMATE} added a card called ${DEMO_CARD_TITLE} to the first column.`}
        {index === STEP_CARD_MOVES && `${DEMO_TEAMMATE} moved it to the next column.`}
      </p>

      {index === STEP_FINALE && <Finale onAddCard={onAddCard} onDismiss={onDismiss} />}
    </div>
  );
}
