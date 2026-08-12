"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/nav/AppSidebar";
import { useAuth } from "@/lib/auth";
import { api, type WorkspaceSummaryResponse } from "@/lib/api";
import { useSidebar } from "@/lib/useSidebar";

/**
 * The signed-in layout: navigation beside whatever page is open.
 *
 * The workspace tree is fetched here rather than in the sidebar so it is
 * fetched once per page rather than once per render of the nav, and so a page
 * that already knows which workspace it is in can say so without the sidebar
 * having to work it out from the URL.
 *
 * A failure is swallowed on purpose — the only such case in the app, and worth
 * saying why. This list is navigation, not content: if it cannot load, the page
 * beside it still works, and an error banner about the *sidebar* on top of a
 * board that is fine would be alarming out of proportion. The sidebar simply
 * shows nothing to navigate to, which is the honest reading of "I could not
 * find out".
 */
export function AppShell({
  workspaceId = null,
  boardId = null,
  children,
}: {
  workspaceId?: string | null;
  boardId?: string | null;
  children: React.ReactNode;
}) {
  const { user, getToken } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryResponse[] | null>(null);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const list = await api.get<WorkspaceSummaryResponse[]>("/workspaces", token);
        if (!cancelled) setWorkspaces(list);
      } catch {
        // See above. Left as null, which reads as "still loading" rather than
        // as an empty workspace — claiming someone has no boards when the
        // request merely failed would be worse than saying nothing.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, getToken]);

  return (
    <div className="flex-1 flex min-h-0">
      <AppSidebar
        workspaces={workspaces}
        currentWorkspaceId={workspaceId}
        currentBoardId={boardId}
        collapsed={collapsed}
        onToggle={toggle}
      />
      {/* `min-w-0`, or the board's horizontally scrolling column row refuses to
          shrink and pushes the sidebar off the screen instead of scrolling. */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
