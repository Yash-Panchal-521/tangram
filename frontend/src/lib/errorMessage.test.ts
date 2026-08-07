import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { friendlyError } from "@/lib/errorMessage";

const api = (status: number, message = "x") => new ApiError(status, message);

describe("friendlyError", () => {
  it("repeats a server rule verbatim, because it explains something the UI cannot", () => {
    const { message, canRetry } = friendlyError(
      api(400, "A workspace must keep at least one owner.")
    );

    expect(message).toBe("A workspace must keep at least one owner.");
    expect(canRetry).toBe(false);
  });

  it.each([
    ["One or more validation errors occurred."],
    ["POST /workspaces failed with 400"],
  ])("does not repeat framework noise: %s", (detail) => {
    // S3.4 — these are developer-facing, so the generic copy is better.
    expect(friendlyError(api(400, detail)).message).not.toContain(detail);
  });

  it("tells an expired session what to do", () => {
    expect(friendlyError(api(401)).message).toContain("Sign in again");
  });

  it("names the attempted action on a permission failure", () => {
    expect(friendlyError(api(403), "delete this column").message).toContain("delete this column");
  });

  it("explains a 404 as someone else's deletion rather than an error", () => {
    expect(friendlyError(api(404)).message).toContain("no longer here");
  });

  it.each([500, 502, 503, 504])("treats %i as the server waking, and retryable", (status) => {
    const { message, canRetry } = friendlyError(api(status));

    expect(message).toContain("waking up");
    expect(canRetry).toBe(true);
  });

  it("distinguishes an unreachable server from a rejected request", () => {
    // fetch() rejects with TypeError when nothing was reached at all.
    const { message, canRetry } = friendlyError(new TypeError("Failed to fetch"));

    expect(message).toContain("Check your connection");
    expect(canRetry).toBe(true);
  });

  it("never leaks protocol detail into the message", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502]) {
      const { message } = friendlyError(api(status, "GET /boards/1 failed with " + status));

      expect(message).not.toMatch(/\bGET\b|\bPOST\b|\/boards|\d{3}\b/);
    }
  });

  it("falls back for an unknown throwable without exploding", () => {
    for (const thrown of [new Error("boom"), "boom", null, undefined, { weird: true }]) {
      expect(friendlyError(thrown, "save").message).toBe("Couldn't save. Try again.");
    }
  });

  it("marks client mistakes as not worth retrying, and outages as worth retrying", () => {
    expect(friendlyError(api(403)).canRetry).toBe(false);
    expect(friendlyError(api(404)).canRetry).toBe(false);
    expect(friendlyError(api(503)).canRetry).toBe(true);
  });
});
