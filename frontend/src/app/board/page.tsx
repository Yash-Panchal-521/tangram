"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { friendlyError } from "@/lib/errorMessage";
import { api, type WorkspaceSummaryResponse } from "@/lib/api";

const BOARD_ID_KEY = "tangram-board-id";

// Decides which board to open on login. Membership is the source of truth --
// asking the server first is what lets someone who was *invited* land on the
// shared board instead of silently bootstrapping a private workspace of their
// own. localStorage is only a "last board opened" preference, and is always
// validated against the workspaces the server actually returned.
export default function BoardBootstrapPage() {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (started.current) return;
    started.current = true;

    const slowTimer = setTimeout(() => setSlow(true), 4000);

    (async () => {
      try {
        const token = await getToken();
        const workspaces = await api.get<WorkspaceSummaryResponse[]>("/workspaces", token);

        const boardIds = new Set(workspaces.flatMap((w) => w.boards.map((b) => b.id)));

        const remembered = localStorage.getItem(BOARD_ID_KEY);
        if (remembered && boardIds.has(remembered)) {
          router.replace(`/board/${remembered}`);
          return;
        }

        const firstBoard = workspaces.flatMap((w) => w.boards)[0];
        if (firstBoard) {
          localStorage.setItem(BOARD_ID_KEY, firstBoard.id);
          router.replace(`/board/${firstBoard.id}`);
          return;
        }

        // Genuinely new: belongs to no workspace that has a board yet. Rather
        // than silently manufacturing a workspace and a board called "My
        // Workspace" and "My Board" -- placeholders nobody chose -- hand over to
        // the welcome screen, which asks for names, a shape, and who else is
        // coming. Skipping there lands exactly where this used to.
        router.replace("/welcome");
      } catch (err) {
        setError(friendlyError(err, "open your board").message);
      } finally {
        clearTimeout(slowTimer);
      }
    })();
  }, [loading, user, router, getToken]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-danger max-w-sm text-center">{error}</p>
      </div>
    );
  }

  // The same silhouette the board route itself shows while loading. This page
  // redirects into that route, so anything else here would flash a second,
  // different loading screen on the way through.
  return <BoardSkeleton slow={slow} />;
}
