import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

function respondWith(body: unknown, status = 400, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": contentType },
      })
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ApiError", () => {
  it("surfaces the ProblemDetails detail rather than a bare status", async () => {
    // This is the only place a rule like the last-owner guard is explained;
    // without it the UI could only say "PATCH failed with 400".
    respondWith({ detail: "A workspace must keep at least one owner." });

    await expect(api.patch("/workspaces/1/members/2", "token", {})).rejects.toThrow(
      "A workspace must keep at least one owner."
    );
  });

  it("falls back to title when there is no detail", async () => {
    respondWith({ title: "One or more validation errors occurred." });

    await expect(api.post("/workspaces", "token", {})).rejects.toThrow(
      "One or more validation errors occurred."
    );
  });

  it("falls back to method and status when the body has neither", async () => {
    respondWith({ errors: { Email: ["required"] } });

    await expect(api.post("/workspaces", "token", {})).rejects.toThrow(
      "POST /workspaces failed with 400"
    );
  });

  it("survives an empty body, which is what Forbid() and NotFound() send", async () => {
    // 403 and 404 from ControllerBase have no body at all; parsing must not
    // throw over the top of the real error.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));

    await expect(api.delete("/workspaces/1/members/2", "token")).rejects.toThrow(
      "DELETE /workspaces/1/members/2 failed with 403"
    );
  });

  it("survives a non-JSON body", async () => {
    respondWith("<html>502 Bad Gateway</html>", 502, "text/html");

    await expect(api.get("/workspaces", "token")).rejects.toThrow(
      "GET /workspaces failed with 502"
    );
  });

  it("carries the status code for callers that branch on it", async () => {
    // The members page distinguishes 404 ("not a member") from everything else.
    respondWith({ detail: "nope" }, 404);

    await expect(api.get("/workspaces/1/members", "token")).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.get("/workspaces/1/members", "token")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("request", () => {
  it("attaches the bearer token when there is one", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/me", "abc123");

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer abc123");
  });

  it("omits the header entirely when unauthenticated", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.get("/health", null);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("returns undefined for 204 instead of trying to parse a body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(api.delete("/boards/1/cards/2", "token")).resolves.toBeUndefined();
  });
});
