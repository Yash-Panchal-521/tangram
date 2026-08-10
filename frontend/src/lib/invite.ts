// The invitee is never emailed — nothing in the stack sends mail — so an owner
// has to pass the invitation along themselves, and this is the text they paste
// into Slack or WhatsApp.
//
// The link carries a token, not an address. That token *is* the invitation:
// whoever opens it can accept, and nothing else grants membership. So this
// message is a secret, and the copy says so rather than leaving an owner to
// assume it is safe to post in a public channel.
//
// Pure on purpose: origin is injected rather than read from window, so it can be
// checked without a DOM and so the message is correct in any environment
// instead of hardcoding localhost.
export function buildInviteMessage({
  workspaceName,
  token,
  origin,
}: {
  workspaceName: string;
  token: string;
  origin: string;
}): string {
  return [
    `You've been invited to "${workspaceName}" on Tangram — a real-time collaborative board.`,
    "",
    `Accept here: ${buildInviteUrl(token, origin)}`,
    "",
    "The link expires in 7 days, and works once. Send it to them directly rather than posting it somewhere public — anyone who opens it can join.",
  ].join("\n");
}

export function buildInviteUrl(token: string, origin: string): string {
  return `${origin}/invite/${encodeURIComponent(token)}`;
}

/**
 * Where the invite page sends someone who has no account yet.
 *
 * The token travels as `invite`, not as `next`: the sign-up page uses it to
 * fetch the offer and show what is being joined, which a plain redirect target
 * could not do. It implies the destination, so `next` stays free for every other
 * flow. Deliberately no `email` parameter — the offer response carries that.
 */
export function buildInviteSignupPath(token: string): string {
  return `/signup?invite=${encodeURIComponent(token)}`;
}

export function buildInviteLoginPath(token: string): string {
  return `/login?invite=${encodeURIComponent(token)}`;
}

/**
 * Coming back to accept, after the sign-in detour.
 *
 * The flag is what separates "signed up in order to join" — where accepting is
 * what the whole trip was for — from someone who merely happens to be signed in
 * when they open a link, who still gets asked.
 */
export function buildInviteReturnPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}?accept=1`;
}

/**
 * What a role lets you do, in the second person.
 *
 * Lives here rather than on the invite page because the sign-up banner says the
 * same thing, and two copies of "what an Editor can do" drift.
 */
export const ROLE_MEANS: Record<string, string> = {
  Owner: "You'll be able to change the board and manage who else is in it.",
  Editor: "You'll be able to add, edit, move and delete columns and cards.",
  Viewer: "You'll be able to see the board and everyone on it live, but not change it.",
};

/**
 * How long an invitation has left, in words.
 *
 * `relativeTime` is deliberately past-only — it floors anything in the future at
 * "just now", which on an expiry date reads as *already gone*. Nothing else in
 * the app has a forward-looking timestamp yet, so this stays local rather than
 * bending the shared helper into both directions.
 */
export function expiresIn(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "soon";

  const hours = (at - now) / 3_600_000;
  if (hours <= 0) return "already";
  if (hours < 1) return "within the hour";
  if (hours < 24) return `in ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * Where to send someone after they sign in, when they arrived mid-flow.
 *
 * Only same-origin *paths* survive. A `?next=` that anyone can put in a URL is
 * an open-redirect otherwise: `//evil.example` and `https://evil.example` are
 * both absolute despite one looking relative, and a phishing page reached
 * straight after a real sign-in is a convincing place to ask for a password
 * again.
 */
export function safeNextPath(raw: string | null, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // Backslashes because some browsers normalise "/\evil.example" to a
  // protocol-relative URL.
  if (raw.startsWith("/\\")) return fallback;
  return raw;
}
