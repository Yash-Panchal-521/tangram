import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Next 16.3 writes `AGENTS.md` and a `CLAUDE.md` containing `@AGENTS.md` into
   * this directory on every `next dev`, and re-creates them if deleted.
   *
   * Off here, for one reason specific to this repo rather than a dislike of the
   * feature: a `CLAUDE.md` inside `frontend/` takes precedence over the one at
   * the root for anything underneath it, and the root file is where every
   * invariant, gotcha and standard in this project is written down. A generated
   * file quietly outranking it is the opposite of what either file is for.
   *
   * The warning it carries is worth keeping, so it has been folded into the root
   * CLAUDE.md instead — one source of truth, which is the convention here.
   */
  agentRules: false,
};

export default nextConfig;
