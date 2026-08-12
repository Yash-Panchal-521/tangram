/**
 * How a column stands against its work-in-progress limits.
 *
 * Atlassian: a column header turns red when the maximum is exceeded and yellow
 * when the minimum is not met, and setting constraints is "a crucial part of
 * kanban, so that you can ensure that work is continually flowing through the
 * pipeline". Both halves matter — over the maximum says the stage is clogged,
 * under the minimum says it is starved and someone downstream is about to go
 * idle.
 *
 * Pure and separate from the component because the interesting part is the
 * boundaries: *at* the maximum is fine, one past it is not, and zero is a limit
 * rather than an absence.
 */
export type LimitState = "none" | "ok" | "under" | "over";

export interface ColumnLimits {
  minCards: number | null;
  maxCards: number | null;
}

export function limitState(count: number, { minCards, maxCards }: ColumnLimits): LimitState {
  if (minCards === null && maxCards === null) return "none";

  // Over wins when a column somehow breaches both — it cannot, given the server
  // rejects a minimum above a maximum, but the reading has to be defined rather
  // than depending on which branch came first.
  if (maxCards !== null && count > maxCards) return "over";
  if (minCards !== null && count < minCards) return "under";
  return "ok";
}

/**
 * The breach in words.
 *
 * Said as well as coloured, always: colour alone fails for anyone who cannot
 * distinguish red from amber, and it fails again for anyone who has never been
 * told what the colours here mean (S5.2). Returns null when there is nothing to
 * announce, so a column at its limit stays quiet.
 */
export function limitMessage(count: number, limits: ColumnLimits): string | null {
  const state = limitState(count, limits);

  if (state === "over") {
    return `Over the limit — ${count} cards, maximum ${limits.maxCards}.`;
  }
  if (state === "under") {
    return `Under the minimum — ${count} of ${limits.minCards}.`;
  }
  return null;
}

/** The limit as it reads beside the count: "3/5", "3/5+", "min 2". */
export function limitLabel({ minCards, maxCards }: ColumnLimits, count: number): string | null {
  if (maxCards !== null) return `${count}/${maxCards}`;
  if (minCards !== null) return `${count} · min ${minCards}`;
  return null;
}
