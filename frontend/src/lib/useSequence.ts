"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Steps a scripted sequence forward, either on a timer or on demand.
 *
 * Shared between the first-run introduction (timed — it plays itself) and any
 * later coach-mark walkthrough (manual — the user presses Next). Those are the
 * same state machine with a different clock, so they are one hook rather than
 * two that drift.
 *
 * `holdMs: null` on a step means "wait for `next()`" and is what makes the
 * manual mode fall out for free.
 */
export function useSequence({
  holds,
  active,
  onDone,
  skipTimers = false,
}: {
  /** Per-step dwell time. `null` holds until `next()` is called. */
  holds: (number | null)[];
  active: boolean;
  onDone?: () => void;
  /**
   * Jump to the final step immediately. Set under `prefers-reduced-motion`,
   * where a self-playing animation is exactly what the user asked not to see —
   * they still get the ending, just without being walked through it.
   */
  skipTimers?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const last = holds.length - 1;

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, last));
  }, [last]);

  const goTo = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(i, last))),
    [last]
  );

  const restart = useCallback(() => setIndex(0), []);

  useEffect(() => {
    if (!active || !skipTimers) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIndex(last);
  }, [active, skipTimers, last]);

  useEffect(() => {
    if (!active || skipTimers) return;
    const hold = holds[index];
    if (hold == null) return;

    const timer = setTimeout(() => {
      if (index === last) onDoneRef.current?.();
      else setIndex((i) => i + 1);
    }, hold);
    return () => clearTimeout(timer);
    // `holds` is a literal array at the call site and would be a new identity
    // every render; its *contents* are what matter and they are constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, skipTimers, index, last]);

  return { index, isLast: index === last, next, goTo, restart };
}
