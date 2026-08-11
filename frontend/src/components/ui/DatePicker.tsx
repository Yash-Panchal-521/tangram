"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  addDays,
  describeDay,
  monthGrid,
  parseValue,
  shiftMonth,
  todayValue,
  WEEKDAY_LABELS,
} from "@/lib/calendar";
import { formatDueDate, dueLabel } from "@/lib/dueDate";
import { useDialog } from "@/lib/useDialog";

/** Enough room for the popover below the trigger; otherwise it opens upward. */
const POPOVER_HEIGHT = 340;

const QUICK_PICKS: { label: string; days: number }[] = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "Next week", days: 7 },
];

/**
 * A date field that opens a month grid, replacing `<input type="date">`.
 *
 * The native control was doing the job, so this is not a rewrite for its own
 * sake — it is what the native control cannot do here:
 *
 * - **Its presentation is the browser's, not ours.** Chrome, Firefox and Safari
 *   each render a different field and a different calendar, none of which take
 *   the app's tokens, so the one control on the board that ignored dark mode was
 *   this one.
 * - **Its value format is the browser's too.** `dd-mm-yyyy` placeholder text
 *   varies by browser locale rather than by the user's, and the empty state read
 *   as a broken input rather than "no due date".
 * - **Most due dates are not a date.** They are "today", "tomorrow", "next
 *   week". A grid makes those three clicks each; naming them makes them one, and
 *   they sit above the grid rather than replacing it.
 *
 * Everything is a `YYYY-MM-DD` string in UTC — see lib/calendar.ts for why there
 * is no `Date` in any of this.
 */
export function DatePicker({
  id,
  value,
  onChange,
  onOpenChange,
  now,
  locale,
}: {
  id?: string;
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Fired when the calendar opens or closes.
   *
   * Exists because this popover traps the keyboard, and a caller that also
   * traps it has to stand down while this is up. Both listen on `document`, so
   * without it one Escape closes the calendar *and* the panel behind it —
   * discarding whatever edit the panel was holding. Same reason ConfirmDialog
   * pauses the panel.
   */
  onOpenChange?: (open: boolean) => void;
  /** Injectable so "Today" is testable without owning the clock. */
  now?: number;
  locale?: string;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Read once, at mount, rather than on every render. `Date.now()` in a default
  // parameter is called each time the component renders, which makes what
  // "today" means depend on when React happened to re-render -- and this field
  // highlights today and offers it as a quick pick. Fixing it at mount is both
  // stable and true for as long as a card panel is realistically open.
  const [mountedNow] = useState(() => Date.now());
  const clock = now ?? mountedNow;
  const today = todayValue(clock);

  // Wrapped so every path in and out reports itself -- the trigger, a pick, a
  // click outside and Escape. A caller pausing its own key handling on this
  // cannot afford one of them to be missed.
  //
  // Held in a ref, assigned in an effect rather than during render: callers
  // pass inline arrows, and depending on the callback directly would re-run the
  // outside-click effect on every render. Same pattern as useDialog.
  const openChangeRef = useRef(onOpenChange);
  useEffect(() => {
    openChangeRef.current = onOpenChange;
  });

  function setOpenAnd(next: boolean) {
    setOpen(next);
    openChangeRef.current?.(next);
  }

  // Closing on an outside click lives here rather than in the popover because it
  // has to know about the trigger too: a pointerdown on the trigger would
  // otherwise close the popover and the button's own click would reopen it, so
  // the control would appear not to close at all.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpenAnd(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // Measured at open: the field sits near the top of the card panel, but
          // this is a shared control and a popover that runs off the bottom of
          // the window is unreachable rather than merely ugly.
          const box = triggerRef.current?.getBoundingClientRect();
          setAbove(!!box && window.innerHeight - box.bottom < POPOVER_HEIGHT);
          setOpenAnd(!open);
        }}
        className={`w-full flex items-center gap-2 text-[13px] bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-left transition-colors hover:border-border-2 focus-visible:border-accent cursor-pointer ${
          value ? "text-text" : "text-text-dim"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
          <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 5.5h11M4.5 1.5v2M9.5 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="flex-1 min-w-0 truncate">
          {value ? formatDueDate(`${value}T00:00:00.000Z`) : "No due date"}
        </span>
        {value && (
          <span className="shrink-0 text-[11px] text-text-muted">
            {dueLabel(`${value}T00:00:00.000Z`, clock)}
          </span>
        )}
      </button>

      {open && (
        <CalendarPopover
          ref={popoverRef}
          value={value}
          today={today}
          above={above}
          locale={locale}
          onPick={(picked) => {
            onChange(picked);
            setOpenAnd(false);
          }}
          onClose={() => setOpenAnd(false)}
        />
      )}
    </div>
  );
}

function CalendarPopover({
  ref: containerRef,
  value,
  today,
  above,
  locale,
  onPick,
  onClose,
}: {
  ref: RefObject<HTMLDivElement | null>;
  value: string;
  today: string;
  above: boolean;
  locale?: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const gridId = useId();

  // The day the arrow keys move. Starts on the selected day, or today when
  // there isn't one -- never on the 1st, which would make every keyboard user
  // travel back through the month before going anywhere.
  const [focusedDay, setFocusedDay] = useState(() => (parseValue(value) ? value : today));
  const parsed = parseValue(focusedDay) ?? parseValue(today)!;
  const [view, setView] = useState({ year: parsed.year, month: parsed.month });

  const grid = monthGrid(view.year, view.month, locale);

  // Follows the roving focus, including when an arrow key crosses into the next
  // month and the whole grid is replaced.
  const focusedRef = useRef<HTMLButtonElement>(null);

  // Opens on the day, not on the first quick pick: the arrow keys are the
  // reason this is a grid, and landing anywhere else means a keyboard user
  // tabs before they can navigate. Matches the WAI-ARIA date picker dialog.
  useDialog({ containerRef, onClose, initialFocusRef: focusedRef });
  const shouldRefocus = useRef(false);
  useEffect(() => {
    if (!shouldRefocus.current) return;
    shouldRefocus.current = false;
    focusedRef.current?.focus();
  });

  function moveTo(day: string) {
    const next = parseValue(day);
    if (!next) return;
    shouldRefocus.current = true;
    setFocusedDay(day);
    setView({ year: next.year, month: next.month });
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    // The WAI-ARIA date-picker grid: arrows by day and week, Page by month,
    // Home/End to the ends of the week.
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };

    if (e.key in moves) {
      e.preventDefault();
      moveTo(addDays(focusedDay, moves[e.key]));
      return;
    }

    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const current = parseValue(focusedDay);
      if (!current) return;
      // Monday-start, so Sunday (getUTCDay 0) is index 6.
      const weekday =
        (new Date(Date.UTC(current.year, current.month, current.dayOfMonth)).getUTCDay() + 6) % 7;
      moveTo(addDays(focusedDay, e.key === "Home" ? -weekday : 6 - weekday));
      return;
    }

    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const by = e.key === "PageUp" ? -1 : 1;
      const next = shiftMonth(view.year, view.month, by);
      const current = parseValue(focusedDay)!;
      // Clamped, so paging from the 31st into a 30-day month lands on the 30th
      // rather than silently skipping a month.
      const lastDay = new Date(Date.UTC(next.year, next.month + 1, 0)).getUTCDate();
      moveTo(
        `${next.year}-${String(next.month + 1).padStart(2, "0")}-${String(
          Math.min(current.dayOfMonth, lastDay)
        ).padStart(2, "0")}`
      );
    }
  }

  function page(by: number) {
    const next = shiftMonth(view.year, view.month, by);
    setView(next);
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a date"
      className={`absolute z-40 left-0 w-[268px] rounded-lg border border-border bg-surface shadow-lg p-2.5 animate-[fade-up_0.12s_ease-out] ${
        above ? "bottom-full mb-1.5" : "top-full mt-1.5"
      }`}
    >
      <div className="flex items-center gap-1.5 pb-2">
        {QUICK_PICKS.map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => onPick(addDays(today, pick.days))}
            className="flex-1 text-[11px] font-medium px-1.5 py-1 rounded-md bg-surface-2 border border-border text-text-muted hover:text-text hover:border-border-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            {pick.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between pb-1.5">
        <button
          type="button"
          onClick={() => page(-1)}
          aria-label="Previous month"
          className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Doubles as the grid's accessible name, rather than an sr-only copy
            of itself -- two nodes saying "August 2026" is two announcements.
            aria-live so paging with the buttons says where you landed;
            arrow-key movement is announced by the focused day itself. */}
        <span id={gridId} aria-live="polite" className="text-[13px] font-medium">
          {grid.label}
        </span>
        <button
          type="button"
          onClick={() => page(1)}
          aria-label="Next month"
          className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div role="grid" aria-labelledby={gridId} onKeyDown={onGridKeyDown}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((day) => (
            <span
              key={day}
              role="columnheader"
              // The full name for a screen reader, two letters on screen: seven
              // three-letter headers do not fit a 268px popover.
              aria-label={day}
              className="h-6 flex items-center justify-center text-[10px] font-semibold text-text-dim"
            >
              {day.slice(0, 2)}
            </span>
          ))}
        </div>

        {grid.weeks.map((week, i) => (
          <div role="row" key={i} className="grid grid-cols-7">
            {week.map((day) => {
              const selected = day.value === value;
              const isFocused = day.value === focusedDay;
              return (
                <button
                  key={day.value}
                  ref={isFocused ? focusedRef : undefined}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-current={day.value === today ? "date" : undefined}
                  aria-label={describeDay(day.value, locale)}
                  // Roving tabindex: one stop for the whole grid, so Tab leaves
                  // the calendar instead of walking 42 buttons.
                  tabIndex={isFocused ? 0 : -1}
                  onFocus={() => setFocusedDay(day.value)}
                  onClick={() => onPick(day.value)}
                  className={`h-8 flex items-center justify-center text-[12px] rounded-md transition-colors cursor-pointer ${
                    selected
                      ? "bg-accent text-accent-fg font-semibold"
                      : day.value === today
                        ? "text-accent font-semibold hover:bg-surface-2"
                        : day.inMonth
                          ? "text-text hover:bg-surface-2"
                          : "text-text-dim hover:bg-surface-2"
                  }`}
                >
                  {day.dayOfMonth}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Removing the date is a different action from picking one, so it is not
          a cell in the grid. Absent when there is nothing to clear -- a control
          that does nothing is worse than no control (S8.1). */}
      {value && (
        <div className="pt-2 mt-1 border-t border-border">
          <button
            type="button"
            onClick={() => onPick("")}
            className="w-full text-[11px] font-medium px-2 py-1.5 rounded-md text-text-muted hover:text-danger hover:bg-surface-2 transition-colors cursor-pointer"
          >
            Clear due date
          </button>
        </div>
      )}
    </div>
  );
}
