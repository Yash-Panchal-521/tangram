/**
 * Month-grid arithmetic for the date picker.
 *
 * Every function here works in UTC and speaks in `YYYY-MM-DD` strings, matching
 * lib/dueDate.ts. That is not a preference: a grid built with `new Date(y, m, d)`
 * is built in the viewer's timezone, and the moment it is converted back to the
 * stored UTC-midnight instant, everyone west of UTC gets the previous day. The
 * classic symptom is clicking the 20th and saving the 19th.
 *
 * So there is no `Date` in any signature. Days are strings, and the only place a
 * `Date` exists is inside a function that immediately turns it back into one.
 */

/** Sunday-indexed, matching `getUTCDay`, but rotated so the week starts Monday. */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface CalendarDay {
  /** `2026-08-20`. */
  value: string;
  /** 1–31, for the label. */
  dayOfMonth: number;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 0-indexed, like `getUTCMonth`. */
  month: number;
  label: string;
  /** Always six rows of seven. */
  weeks: CalendarDay[][];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toValue(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today as a day, in UTC. Injectable so tests are not hostage to the clock. */
export function todayValue(now: number = Date.now()): string {
  return toValue(now);
}

/** Shifts a day by whole days. Safe across months, years and leap days. */
export function addDays(value: string, days: number): string {
  const parsed = parseValue(value);
  if (!parsed) return value;
  return toValue(Date.UTC(parsed.year, parsed.month, parsed.dayOfMonth + days));
}

export function parseValue(
  value: string
): { year: number; month: number; dayOfMonth: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [year, month, dayOfMonth] = [+match[1], +match[2] - 1, +match[3]];
  // Rejects 2026-02-30, which Date.UTC would silently roll into March.
  const utc = Date.UTC(year, month, dayOfMonth);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== dayOfMonth) {
    return null;
  }
  return { year, month, dayOfMonth };
}

/**
 * The six-week grid for a month.
 *
 * Always six rows, even when five would do. A grid that changes height as you
 * page through months makes the popover jump under the pointer, and on the row
 * that gains or loses a week the day under the cursor changes without the
 * cursor moving.
 */
export function monthGrid(year: number, month: number, locale?: string): CalendarMonth {
  const firstOfMonth = Date.UTC(year, month, 1);
  // getUTCDay is Sunday-0; the grid starts Monday, so Sunday has to become 6.
  const leadingDays = (new Date(firstOfMonth).getUTCDay() + 6) % 7;
  const gridStart = Date.UTC(year, month, 1 - leadingDays);

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      const utc = Date.UTC(year, month, 1 - leadingDays + week * 7 + day);
      const d = new Date(utc);
      row.push({
        value: toValue(utc),
        dayOfMonth: d.getUTCDate(),
        inMonth: d.getUTCMonth() === ((month % 12) + 12) % 12,
      });
    }
    weeks.push(row);
  }

  return {
    year,
    month,
    label: new Date(gridStart + 15 * 86_400_000).toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    weeks,
  };
}

/** Steps the visible month, carrying the year. */
export function shiftMonth(
  year: number,
  month: number,
  by: number
): { year: number; month: number } {
  const total = year * 12 + month + by;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** How a day should be announced when it has focus — "Thursday 20 August 2026". */
export function describeDay(value: string, locale?: string): string {
  const parsed = parseValue(value);
  if (!parsed) return value;
  return new Date(Date.UTC(parsed.year, parsed.month, parsed.dayOfMonth)).toLocaleDateString(
    locale,
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
  );
}
