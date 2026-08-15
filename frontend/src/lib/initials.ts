/**
 * Two letters standing in for a name — "Rita Menon" becomes "RM".
 *
 * Extracted because there were three copies: Avatar, the lane header, and the
 * card face. Two of them already disagreed about the empty case, which is the
 * drift that forced `relativeTime` out into its own module for the same reason.
 *
 * Two letters at most, so a long name and a short one occupy the same square.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
