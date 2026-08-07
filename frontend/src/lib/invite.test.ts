import { describe, expect, it } from "vitest";
import { buildInviteMessage, buildSignupUrl } from "@/lib/invite";

const ORIGIN = "https://tangram-mu.vercel.app";

describe("buildSignupUrl", () => {
  it("points at the signup page with the address prefilled", () => {
    expect(buildSignupUrl("sam@example.com", ORIGIN)).toBe(
      `${ORIGIN}/signup?email=sam%40example.com`
    );
  });

  it("encodes characters that would otherwise break the query string", () => {
    // A plus in an address is legal and common (sam+tangram@…). Left raw it
    // decodes as a space, the address no longer matches, and the invitation
    // silently never resolves.
    expect(buildSignupUrl("sam+tangram@example.com", ORIGIN)).toContain(
      "email=sam%2Btangram%40example.com"
    );
  });

  it("uses whichever origin it is given", () => {
    // Read from window at click time rather than baked in, so the link is
    // right in local dev and in production without a rebuild.
    expect(buildSignupUrl("sam@example.com", "http://localhost:3000")).toMatch(
      /^http:\/\/localhost:3000\/signup\?/
    );
  });
});

describe("buildInviteMessage", () => {
  const message = buildInviteMessage({
    workspaceName: "Acme Team",
    email: "sam@example.com",
    origin: ORIGIN,
  });

  it("names the workspace", () => {
    expect(message).toContain('"Acme Team"');
  });

  it("carries the signup link", () => {
    expect(message).toContain(buildSignupUrl("sam@example.com", ORIGIN));
  });

  it("spells out that the address must match", () => {
    // Nothing emails the invitee, and claiming is an exact-match lookup on the
    // normalised address, so signing up with a different one silently fails.
    // The message has to say so.
    expect(message).toContain("sam@example.com");
    expect(message.toLowerCase()).toContain("invitation is tied to that address");
  });

  it("survives a workspace name containing quotes", () => {
    const odd = buildInviteMessage({
      workspaceName: 'Sam"s Team',
      email: "a@b.com",
      origin: ORIGIN,
    });

    expect(odd).toContain('Sam"s Team');
  });
});
