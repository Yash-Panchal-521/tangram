// The invitee is never emailed — nothing in the stack sends mail, and there is
// no tokenised join link. So an owner has to pass the invitation along
// themselves, and this is the text they paste into Slack or WhatsApp.
//
// Pure on purpose: origin is injected rather than read from window, so it can
// be checked without a DOM and so the message is correct in any environment
// instead of hardcoding localhost.
export function buildInviteMessage({
  workspaceName,
  email,
  origin,
}: {
  workspaceName: string;
  email: string;
  origin: string;
}): string {
  return [
    `You've been invited to "${workspaceName}" on Tangram — a real-time collaborative board.`,
    "",
    `Sign up here: ${buildSignupUrl(email, origin)}`,
    "",
    // Claiming matches on the exact normalised address, so signing up with a
    // different one silently never joins the workspace. Worth spelling out.
    `Use ${email} when you sign up — the invitation is tied to that address, and you'll land straight on the board.`,
  ].join("\n");
}

export function buildSignupUrl(email: string, origin: string): string {
  return `${origin}/signup?email=${encodeURIComponent(email)}`;
}
