import { describe, expect, it } from "vitest";
import { FirebaseError } from "firebase/app";
import { friendlyAuthError } from "@/lib/authForm";

const forCode = (code: string) => friendlyAuthError(new FirebaseError(code, "raw firebase text"));

describe("friendlyAuthError", () => {
  it.each([
    ["auth/invalid-credential", "Incorrect email or password."],
    ["auth/wrong-password", "Incorrect email or password."],
    ["auth/user-not-found", "Incorrect email or password."],
    ["auth/invalid-email", "Enter a valid email address."],
    ["auth/too-many-requests", "Too many attempts. Try again in a moment."],
    ["auth/email-already-in-use", "That email already has an account. Try signing in instead."],
    ["auth/weak-password", "Choose a password of at least 6 characters."],
  ])("maps %s to something a person can act on", (code, expected) => {
    expect(forCode(code)).toBe(expected);
  });

  it("gives the same answer for wrong-password and user-not-found", () => {
    // Deliberate: distinguishing them tells an attacker which addresses have
    // accounts. Firebase itself collapses these into invalid-credential now,
    // and the copy shouldn't reintroduce the distinction.
    expect(forCode("auth/wrong-password")).toBe(forCode("auth/user-not-found"));
  });

  it("explains a misconfigured project rather than blaming the user", () => {
    expect(forCode("auth/operation-not-allowed")).toContain("isn't enabled for this project");
  });

  it("distinguishes a network failure from bad credentials", () => {
    expect(forCode("auth/network-request-failed")).toContain("Network");
  });

  it("falls back for an unrecognised Firebase code", () => {
    expect(forCode("auth/some-code-that-does-not-exist-yet")).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("never leaks raw Firebase text to the user", () => {
    // The default message is developer-facing and often names internals.
    expect(forCode("auth/internal-error")).not.toContain("raw firebase text");
  });

  it.each([
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
  ])("handles %s without throwing", (_label, thrown) => {
    expect(friendlyAuthError(thrown)).toBe("Something went wrong. Please try again.");
  });
});
