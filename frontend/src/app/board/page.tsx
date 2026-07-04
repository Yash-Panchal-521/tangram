"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api, WorkspaceResponse, BoardResponse } from "@/lib/api";

const BOARD_ID_KEY = "tangram-board-id";
const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

// Slice 1 has no "list my workspaces/boards" endpoint yet (that's Slice 4).
// So on first login we bootstrap one workspace + board + starter columns via
// the plain create endpoints, and remember the board id locally.
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
      const existingBoardId = localStorage.getItem(BOARD_ID_KEY);
      if (existingBoardId) {
        router.replace(`/board/${existingBoardId}`);
        return;
      }

      try {
        const token = await getToken();
        const workspace = await api.post<WorkspaceResponse>("/workspaces", token, {
          name: "My Workspace",
        });
        const board = await api.post<BoardResponse>(
          `/workspaces/${workspace.id}/boards`,
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
