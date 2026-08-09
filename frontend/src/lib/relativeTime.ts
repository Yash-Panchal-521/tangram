/**
 * Short relative time for feeds — "just now", "4m", "3h", "2d".
 *
 * Extracted from the members page, which grew its own copy first. Two
 * implementations of "how long ago" drift, and the drift is invisible until two
 * surfaces disagree about the same timestamp.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";

  const seconds = Math.round((now - then) / 1000);
  // Clocks disagree, and a timestamp a second in the future should not read as
  // "in -1 minutes".
  if (seconds < 45) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
