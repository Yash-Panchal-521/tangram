import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

/**
 * This route has exactly one consumer, and it is a workflow rather than a person.
 *
 * CI advances `release`, then polls here until the commit matches the SHA it
 * promoted. Removing the field or letting the response be cached would not fail
 * loudly — the poll would simply never match, or would match the *previous*
 * deployment and report success for a build that never went out. Both are worse
 * than having no check, because both look like one.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("frontend health route", () => {
  it("reports the commit Vercel built", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");

    const body = await (GET() as Response).json();

    expect(body).toEqual({ status: "ok", commit: "abc123" });
  });

  it("says 'local' when there is no deployment", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");

    const body = await (GET() as Response).json();

    expect(body.commit).toBe("local");
  });

  it("forbids caching, so the poll cannot read the previous deployment", async () => {
    const response = GET() as Response;

    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
