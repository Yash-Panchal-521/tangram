/**
 * Which commit this deployment is serving.
 *
 * The mirror of the API's `/health`, and it exists for the same one consumer:
 * CI. The `ship` job confirms the backend is live before advancing `release`,
 * then stops — so a failed Vercel build left a green pipeline, a correct branch
 * pointer, and the previous frontend still serving, with nothing to say so.
 * That is the exact failure the job was written to prevent, moved one step later.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set by Vercel for both the build and the runtime.
 * Locally there is no such variable and "local" is the honest answer, matching
 * what the backend reports off a developer's machine.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      // `||`, not `??`: an env var that exists but is empty is a real state,
      // and `??` would let "" through. CI compares this against a SHA, so an
      // empty string means polling until the ten-minute timeout with nothing
      // to explain why.
      commit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
    },
    {
      // Without this the CDN can answer the poll from the *previous*
      // deployment's cache, which would report success for a build that never
      // went out — worse than no check, because it looks like one.
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );
}
