"use client";

import Link from "next/link";
import { TangramMark } from "@/components/ui/TangramMark";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import type { WorkspaceSummaryResponse } from "@/lib/api";

/**
 * The app's navigation: which workspace, which board, and who is in it.
 *
 * Jira's split, which is the useful part of its navigation rather than its
 * shape: **the sidebar navigates between things, the top bar acts on the
 * current thing.** So Create, the sync indicator and the account menu stay in
 * the header — Jira keeps Create in the top bar too, even in its newest nav —
 * and switching board or workspace moves here.
 *
 * Collapsible, and that is not decoration. The board is the widest surface in
 * the app and scrolls horizontally, so every pixel this takes is one the
 * columns lose. Jira collapses its sidebar for exactly that reason.
 *
 * Archived boards are left out. They are reachable from the workspace home,
 * which is where deciding what to do with them belongs; a nav list is for the
 * places you are going.
 */
export function AppSidebar({
  workspaces,
  currentWorkspaceId,
  currentBoardId,
  collapsed,
  onToggle,
}: {
  /** Null while loading — the whole tree arrives in one `GET /workspaces`. */
  workspaces: WorkspaceSummaryResponse[] | null;
  currentWorkspaceId: string | null;
  currentBoardId: string | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Falls back to whichever workspace contains the open board. The board route
  // knows its board id but not its workspace until the board itself loads, and
  // a sidebar that picks the wrong workspace for a second is worse than one
  // that works it out from what it already has.
  const current =
    workspaces?.find((w) => w.id === currentWorkspaceId) ??
    workspaces?.find((w) => w.boards.some((b) => b.id === currentBoardId)) ??
    workspaces?.[0] ??
    null;
  const boards = current?.boards.filter((b) => !b.archived) ?? [];

  return (
    <nav
      aria-label="Workspaces and boards"
      className={`shrink-0 h-full flex flex-col border-r border-border bg-surface transition-[width] duration-150 ${
        collapsed ? "w-[52px]" : "w-[228px]"
      }`}
    >
      <div className="h-[52px] shrink-0 flex items-center gap-2 px-2.5 border-b border-border">
        <Link
          href="/boards"
          aria-label="All boards"
          className="w-7 h-7 shrink-0 rounded-md bg-accent flex items-center justify-center hover:opacity-85 transition-opacity"
        >
          <TangramMark size={15} color="var(--accent-fg)" />
        </Link>

        {!collapsed &&
          (workspaces === null ? (
            <Skeleton className="h-3.5 flex-1 rounded" />
          ) : (
            <WorkspaceSwitcher workspaces={workspaces} current={current} />
          ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {!collapsed && (
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            Boards
          </p>
        )}

        {workspaces === null ? (
          <div className="flex flex-col gap-1.5 px-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 rounded-md" />
            ))}
          </div>
        ) : boards.length === 0 ? (
          !collapsed && (
            <p className="px-3 text-[11px] text-text-dim leading-relaxed">
              No boards yet. The workspace home is where you make one.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-0.5 px-1.5">
            {boards.map((board) => {
              const active = board.id === currentBoardId;
              return (
                <li key={board.id}>
                  <Link
                    href={`/board/${board.id}`}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? board.name : undefined}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      active
                        ? "bg-accent/10 text-text font-medium"
                        : "text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    {/* Carries the current board when collapsed, where the
                        name cannot. Its first letter is not identity, but it
                        is enough to tell two boards apart at a glance. */}
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 shrink-0 rounded flex items-center justify-center text-[10px] font-semibold ${
                        active ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-dim"
                      }`}
                    >
                      {board.name.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    {!collapsed && <span className="truncate">{board.name}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-1.5 flex flex-col gap-0.5">
        {current && (
          <Link
            href={`/workspace/${current.id}/members`}
            data-tour="members"
            title={collapsed ? "Members" : undefined}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <circle cx="5.25" cy="4.5" r="2.25" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M1.25 11.5c0-1.8 1.79-3.25 4-3.25s4 1.45 4 3.25"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M10 2.6a2.25 2.25 0 010 3.8M11.4 8.5c1.35.42 2.35 1.6 2.35 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            {!collapsed && <span className="truncate">Members</span>}
          </Link>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-dim hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-180"}`}
          >
            <path
              d="M5.5 3.5L9 7l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {!collapsed && <span className="truncate">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}

/**
 * Which workspace you are looking at, and the way to another.
 *
 * A plain label when there is only one, because a switcher offering a single
 * choice is a control that does nothing — and one workspace is the common case
 * until somebody is invited somewhere.
 */
function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: WorkspaceSummaryResponse[];
  current: WorkspaceSummaryResponse | null;
}) {
  if (!current) return null;

  if (workspaces.length === 1) {
    return <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">{current.name}</span>;
  }

  return (
    <Menu
      label="Switch workspace"
      align="left"
      trigger={<span className="max-w-[130px] truncate font-semibold">{current.name}</span>}
    >
      {(close) => (
        <>
          {workspaces.map((workspace) => {
            // Straight to a board where there is one: landing on the workspace
            // home after choosing a workspace is a second choice nobody asked
            // to make.
            const first = workspace.boards.find((b) => !b.archived);
            return (
              <MenuItem
                key={workspace.id}
                onSelect={() => {
                  close();
                  window.location.href = first ? `/board/${first.id}` : "/boards";
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === current.id && (
                    <span className="text-[10px] text-text-dim">current</span>
                  )}
                </span>
              </MenuItem>
            );
          })}
        </>
      )}
    </Menu>
  );
}
