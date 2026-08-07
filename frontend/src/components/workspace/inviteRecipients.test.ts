import { describe, expect, it } from "vitest";
import {
  statusHint,
  statusOf,
  toRecipients,
  type RecipientContext,
} from "@/components/workspace/InviteRecipientsInput";
import type { MembershipRole } from "@/lib/api";

const context: RecipientContext = {
  myEmail: "me@example.com",
  memberEmails: new Map<string, MembershipRole>([["sara@example.com", "Editor"]]),
  invitedEmails: new Map<string, MembershipRole>([["pending@example.com", "Viewer"]]),
};

const emails = (raw: string, existing = []) =>
  toRecipients(raw, "Editor", existing).map((r) => r.email);

describe("toRecipients", () => {
  it("splits on commas, semicolons and whitespace alike", () => {
    expect(emails("a@b.com, c@d.com; e@f.com\ng@h.com")).toEqual([
      "a@b.com",
      "c@d.com",
      "e@f.com",
      "g@h.com",
    ]);
  });

  it("lowercases, so matching against stored addresses is exact", () => {
    // Claiming is an exact lookup on the normalised address; a stray capital
    // would mean the invitation never resolves.
    expect(emails("Sam@Example.COM")).toEqual(["sam@example.com"]);
  });

  it("trims surrounding whitespace", () => {
    expect(emails("   a@b.com   ")).toEqual(["a@b.com"]);
  });

  it("drops empties from repeated separators", () => {
    expect(emails("a@b.com,,  ,;c@d.com")).toEqual(["a@b.com", "c@d.com"]);
  });

  it("deduplicates within one paste", () => {
    expect(emails("a@b.com, a@b.com, A@B.com")).toEqual(["a@b.com"]);
  });

  it("deduplicates against chips already present", () => {
    const existing = toRecipients("a@b.com", "Editor", []);

    expect(toRecipients("a@b.com, c@d.com", "Editor", existing).map((r) => r.email)).toEqual([
      "c@d.com",
    ]);
  });

  it("assigns the given role to everything it creates", () => {
    expect(toRecipients("a@b.com, c@d.com", "Viewer", []).every((r) => r.role === "Viewer")).toBe(
      true
    );
  });

  it("gives each recipient a distinct id for React keys", () => {
    const ids = toRecipients("a@b.com, c@d.com, e@f.com", "Editor", []).map((r) => r.id);

    expect(new Set(ids).size).toBe(3);
  });

  it("returns nothing for blank input", () => {
    expect(emails("   ")).toEqual([]);
  });
});

describe("statusOf", () => {
  const check = (email: string) => statusOf({ id: "x", email, role: "Editor" }, context);

  it("accepts a plausible address", () => {
    expect(check("new@example.com")).toBe("ok");
  });

  it.each(["nope", "no-at-sign.com", "missing@tld", "two@@at.com", "spa ce@example.com"])(
    "rejects %s as invalid",
    (bad) => expect(check(bad)).toBe("invalid")
  );

  it("flags the caller's own address", () => {
    expect(check("me@example.com")).toBe("self");
  });

  it("flags an existing member", () => {
    expect(check("sara@example.com")).toBe("member");
  });

  it("flags an address already invited", () => {
    expect(check("pending@example.com")).toBe("invited");
  });

  it("checks validity before membership", () => {
    // Order matters: an unparseable address should read as invalid rather
    // than falling through to a membership lookup that can't match anyway.
    const noEmailContext: RecipientContext = { ...context, myEmail: null };
    expect(statusOf({ id: "x", email: "nope", role: "Editor" }, noEmailContext)).toBe("invalid");
  });

  it("treats nobody as self when the caller's email is unknown", () => {
    const anonymous: RecipientContext = { ...context, myEmail: null };
    expect(statusOf({ id: "x", email: "me@example.com", role: "Editor" }, anonymous)).toBe("ok");
  });
});

describe("statusHint", () => {
  it("says what sending will actually do to an existing member", () => {
    const recipient = { id: "x", email: "sara@example.com", role: "Viewer" as MembershipRole };

    expect(statusHint(recipient, "member", context)).toBe(
      "Already an Editor — sending will change their role to Viewer."
    );
  });

  it("says a pending invite will be updated, not duplicated", () => {
    const recipient = { id: "x", email: "pending@example.com", role: "Owner" as MembershipRole };

    expect(statusHint(recipient, "invited", context)).toContain("updates the pending role to Owner");
  });

  it("has no hint for a clean address", () => {
    expect(statusHint({ id: "x", email: "new@example.com", role: "Editor" }, "ok", context)).toBeUndefined();
  });
});
