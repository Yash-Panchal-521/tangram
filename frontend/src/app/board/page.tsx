"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  api,
  WorkspaceResponse,
  BoardResponse,
  WorkspaceSummaryResponse,
} from "@/lib/api";

const BOARD_ID_KEY = "tangram-board-id";
const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

// Decides which board to open on login. Membership is the source of truth --
// asking the server first is what lets someone who was *invited* land on the
// shared board instead of silently bootstrapping a private workspace of their
// own. localStorage is only a "last board opened" preference, and is always
// validated against the workspaces the server actually returned.
export default function BoardBootstrapPage() {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (started.current) return;
    started.current = true;

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

        // Genuinely new: belongs to no workspace that has a board yet. Reuse an
        // existing empty workspace rather than stacking a second one.
        const workspaceId =
          workspaces[0]?.id ??
          (await api.post<WorkspaceResponse>("/workspaces", token, { name: "My Workspace" })).id;

        const board = await api.post<BoardResponse>(
          `/workspaces/${workspaceId}/boards`,
          token,
          { name: "My Board" }
        );
        for (const name of DEFAULT_COLUMNS) {
          await api.post(`/boards/${board.id}/columns`, token, { name });
        }

        localStorage.setItem(BOARD_ID_KEY, board.id);
        router.replace(`/board/${board.id}`);
      } catch {
        setError("Couldn't set up your workspace. Is the backend running?");
      }
    })();
  }, [loading, user, router, getToken]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-text-muted">{error ?? "Setting up your workspace…"}</p>
    </div>
  );
}
