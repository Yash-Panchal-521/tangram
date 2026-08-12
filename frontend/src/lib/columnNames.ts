/**
 * Turns "To Do, In Progress, Done" into the columns it names.
 *
 * Pure and separate from the field because the interesting behaviour is all in
 * the edges — a trailing comma, a doubled one, the same name twice — and none of
 * that is worth a rendered component to test.
 */

/** The ceiling the API enforces; mirrored so the field can say so first. */
export const MAX_COLUMNS = 8;

export function parseColumnNames(input: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const raw of input.split(",")) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;

    // Deduplicated case-insensitively. Two columns called "Done" and "done" are
    // indistinguishable on a board, and someone typing a list is far more likely
    // to have repeated themselves than to have meant both.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Why this list cannot be used, or null when it can.
 *
 * Returned as a message rather than a boolean so the field says the same thing
 * the server would, before spending a round trip on it.
 */
export function columnNamesProblem(names: string[]): string | null {
  if (names.length === 0) return "Name at least one column.";
  if (names.length > MAX_COLUMNS) {
    return `That's ${names.length} columns — ${MAX_COLUMNS} is the most a board can take at once.`;
  }
  return null;
}
