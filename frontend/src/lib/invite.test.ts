import { describe, expect, it } from "vitest";
import { buildInviteMessage, buildInviteUrl, expiresIn, safeNextPath } from "@/lib/invite";

const ORIGIN = "https://tangram-mu.vercel.app";
const TOKEN = "Zm9vYmFy-_abc123";

describe("buildInviteUrl", () => {
  it("points at the invite page for that token", () => {
    expect(buildInviteUrl(TOKEN, ORIGIN)).toBe(`${ORIGIN}/invite/${TOKEN}`);
  });

  it("leaves base64url characters alone", () => {
    // The token is base64url — "-" and "_" are in the alphabet and must survive
    // the round trip, or every link 404s.
    expect(buildInviteUrl("a-b_c", ORIGIN)).toBe(`${ORIGIN}/invite/a-b_c`);
  });

  it("escapes anything that would break out of the path", () => {
    expect(buildInviteUrl("a/b?c", ORIGIN)).toBe(`${ORIGIN}/invite/a%2Fb%3Fc`);
  });

  it("uses whichever origin it is given", () => {
    // Read from window at click time rather than baked in, so the link is right
    // in local dev and in production without a rebuild.
    expect(buildInviteUrl(TOKEN, "http://localhost:3000")).toMatch(
      /^http:\/\/localhost:3000\/invite\//
    );
  });
});

describe("buildInviteMessage", () => {
  const message = buildInviteMessage({
    workspaceName: "Acme Team",
    token: TOKEN,
    origin: ORIGIN,
  });

  it("names the workspace", () => {
    expect(message).toContain('"Acme Team"');
  });

  it("carries the invite link", () => {
    expect(message).toContain(buildInviteUrl(TOKEN, ORIGIN));
  });

  it("warns that the link is the credential", () => {
    // Anyone holding it can join, so an owner posting it in a public channel is
    // the failure this sentence exists to prevent.
    expect(message).toContain("anyone who opens it can join");
  });

  it("says how long it lasts", () => {
    expect(message).toContain("7 days");
  });

  it("survives a workspace name containing quotes", () => {
    const odd = buildInviteMessage({
      workspaceName: 'Sam"s Team',
      token: TOKEN,
      origin: ORIGIN,
    });

    expect(odd).toContain('Sam"s Team');
  });
});

describe("expiresIn", () => {
  const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  it("counts forward in days", () => {
    expect(expiresIn(at(7 * 86_400_000), NOW)).toBe("in 7 days");
  });

  it("says tomorrow rather than 'in 1 days'", () => {
    expect(expiresIn(at(26 * 3_600_000), NOW)).toBe("tomorrow");
  });

  it("switches to hours inside a day", () => {
    expect(expiresIn(at(5 * 3_600_000), NOW)).toBe("in 5 hours");
    expect(expiresIn(at(3_600_000 + 60_000), NOW)).toBe("in 1 hour");
  });

  it("does not read as gone when it is nearly gone", () => {
    expect(expiresIn(at(600_000), NOW)).toBe("within the hour");
  });

  it("reports the past as past", () => {
    // relativeTime floors the future at "just now", which on an expiry reads as
    // already-expired. This is the whole reason the helper is separate.
    expect(expiresIn(at(-60_000), NOW)).toBe("already");
  });

  it("degrades rather than printing NaN", () => {
    expect(expiresIn("not a date", NOW)).toBe("soon");
  });
});

describe("safeNextPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeNextPath("/invite/abc", "/board")).toBe("/invite/abc");
  });

  it("falls back when absent", () => {
    expect(safeNextPath(null, "/board")).toBe("/board");
    expect(safeNextPath("", "/board")).toBe("/board");
  });

  it("refuses an absolute URL", () => {
    // Open redirect: a phishing page reached straight after a genuine sign-in
    // is a convincing place to ask for the password again.
    expect(safeNextPath("https://evil.example/login", "/board")).toBe("/board");
  });

  it("refuses a protocol-relative URL that looks like a path", () => {
    expect(safeNextPath("//evil.example", "/board")).toBe("/board");
  });

  it("refuses the backslash variant browsers normalise", () => {
    expect(safeNextPath("/\\evil.example", "/board")).toBe("/board");
  });
});
