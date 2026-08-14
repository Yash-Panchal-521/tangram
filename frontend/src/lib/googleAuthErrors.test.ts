import { FirebaseError } from "firebase/app";
import { describe, expect, it } from "vitest";
import { friendlyGoogleError } from "@/lib/authForm";

/**
 * The popup flow fails in ways the password flow cannot, and two of them are not
 * failures: closing the window is a decision.
 */
describe("friendlyGoogleError", () => {
  it("says nothing when the person closed the popup", () => {
    // Showing "something went wrong" for a deliberate cancel is how an app
    // teaches people that its error messages are noise.
    for (const code of [
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/user-cancelled",
    ]) {
      expect(friendlyGoogleError(new FirebaseError(code, code))).toBeNull();
    }
  });

  it("tells someone whose browser blocked the window what to change", () => {
    const message = friendlyGoogleError(new FirebaseError("auth/popup-blocked", "blocked"));

    expect(message).toMatch(/pop-?ups/i);
    // S3.2: name the next action, not just the problem.
    expect(message).toMatch(/allow/i);
  });

  it("sends an existing password account back to the password form", () => {
    // Firebase's one-account-per-email setting produces this when the address
    // is already registered. "Try again" would be advice that cannot work.
    const message = friendlyGoogleError(
      new FirebaseError("auth/account-exists-with-different-credential", "exists")
    );

    expect(message).toMatch(/password/i);
  });

  it("names no infrastructure when the provider is disabled", () => {
    // S3.1. The person reading this is usually not the project owner and cannot
    // enable anything, so the useful half is the alternative that works today.
    const message = friendlyGoogleError(
      new FirebaseError("auth/operation-not-allowed", "disabled")
    );

    expect(message).toMatch(/email and password/i);
    for (const word of [/firebase/i, /console/i, /provider/i, /project/i]) {
      expect(message).not.toMatch(word);
    }
  });

  it("falls back rather than surfacing a raw code", () => {
    const message = friendlyGoogleError(new FirebaseError("auth/internal-error", "boom"));

    expect(message).toBeTruthy();
    expect(message).not.toMatch(/auth\//);
  });

  it("handles something that is not a Firebase error at all", () => {
    expect(friendlyGoogleError(new TypeError("undefined is not a function"))).toBeTruthy();
  });
});
