/**
 * Due dates are stored as UTC midnight on the due day, and every function here
 * treats them as *days*. Reading them back through the local timezone is the
 * classic way a card becomes due "yesterday" for anyone west of UTC.
 */

export type DueStatus = "overdue" | "today" | "soon" | "later";

/** `2026-08-20` — the value an `<input type="date">` expects. */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** The inverse: a date input's value as UTC midnight. */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Whole days between today and the due day, both taken as UTC days. */
export function daysUntilDue(iso: string, now: number = Date.now()): number {
  const due = Date.UTC(
    new Date(iso).getUTCFullYear(),
    new Date(iso).getUTCMonth(),
    new Date(iso).getUTCDate()
  );
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - start) / 86_400_000);
}

export function dueStatus(iso: string, now: number = Date.now()): DueStatus {
  const days = daysUntilDue(iso, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  // Two days is the horizon at which a date stops being background information
  // and starts being something to act on.
  if (days <= 2) return "soon";
  return "later";
}

/** Short label for a card badge — "2d late", "Today", "in 3d", "20 Aug". */
export function dueLabel(iso: string, now: number = Date.now()): string {
  const days = daysUntilDue(iso, now);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 6) return `in ${days}d`;

  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}
