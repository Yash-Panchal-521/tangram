"use client";

import Link from "next/link";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Skeleton } from "@/components/ui/Skeleton";
import { identityColor } from "@/lib/identityColors";
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
      className={`shrink-0 h-full flex flex-col border-r border-border bg-surface-2 transition-[width] duration-150 px-2.5 pt-3.5 pb-3 ${
        collapsed ? "w-[56px]" : "w-[208px]"
      }`}
    >
      {/* The workspace, and the way out of the board. A square tile in --text
          rather than the accent: the accent is spent on the current board's bar
          below, and two accents in one 208px column compete. */}
      {/* Stacks when collapsed. The mark and the chevron are 24px each with a
          10px gap, which is 58px inside a 56px rail — laid out in a row they
          overflowed and the chevron floated outside the sidebar entirely, over
          the board. Vertical is also the only arrangement that keeps the
          chevron inside the rail it belongs to. */}
      <div
        className={`shrink-0 px-0.5 pb-3.5 border-b border-border flex ${
          collapsed ? "flex-col items-center gap-2" : "items-center gap-2.5"
        }`}
      >
        <Link
          href="/boards"
          aria-label="All boards"
          className="w-6 h-6 shrink-0 rounded-md bg-text text-bg flex items-center justify-center text-[13px] font-semibold hover:opacity-85 transition-opacity"
          style={{ fontFamily: "var(--font-display)" }}
        >
          T
        </Link>

        {!collapsed &&
          (workspaces === null ? (
            <Skeleton className="h-3.5 flex-1 rounded" />
          ) : (
            <WorkspaceSwitcher workspaces={workspaces} current={current} />
          ))}

        {/* In the header row, beside the thing it collapses.

            This lived at the very bottom of the rail, as a 23px icon under
            Members. It worked, and it was findable by a screen reader — but at
            the bottom of a full-height column it reads as another nav item
            rather than as a control over the column itself, and it was missed
            entirely by someone looking straight at it. A chevron next to the
            workspace name says what it acts on by sitting on it. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-text-dim hover:bg-surface-2 hover:text-text transition-colors cursor-pointer"
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
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {!collapsed && (
          <p className="px-1 pt-3 pb-1.5 text-[9.5px] uppercase tracking-[0.11em] text-text-dim">
            Boards
          </p>
        )}

        {workspaces === null ? (
          <div className="flex flex-col gap-1.5 pt-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : boards.length === 0 ? (
          !collapsed && (
            <p className="px-1 text-[11px] text-text-dim leading-relaxed">
              No boards yet. The workspace home is where you make one.
            </p>
          )
        ) : (
          <ul className={`flex flex-col gap-px ${collapsed ? "pt-3" : ""}`}>
            {boards.map((board) => {
              const active = board.id === currentBoardId;
              return (
                <li key={board.id}>
                  <Link
                    href={`/board/${board.id}`}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? board.name : undefined}
                    className={`grid grid-cols-[3px_1fr] gap-2.5 items-center px-1.5 py-1.5 rounded-md transition-colors ${
                      active ? "bg-surface" : "hover:bg-surface"
                    }`}
                  >
                    {/* A colour bar, not a letter tile. It is the same job the
                        avatar palette does for people — four rows in one
                        typeface are four rows you have to read — and it survives
                        the collapse, where a name cannot. */}
                    <span
                      aria-hidden="true"
                      className="self-stretch rounded-md"
                      style={{
                        background: active ? "var(--accent)" : identityColor(board.id),
                        opacity: active ? 1 : 0.7,
                      }}
                    />
                    {collapsed ? (
                      <span
                        aria-hidden="true"
                        className={`text-[10.5px] text-left ${
                          active ? "font-medium text-text" : "text-text-muted"
                        }`}
                      >
                        {board.name.trim().charAt(0).toUpperCase() || "?"}
                      </span>
                    ) : (
                      // The design puts a card count at the right of each row.
                      // WorkspaceBoardSummary does not carry one, and inventing
                      // a number here would be worse than omitting it. It needs
                      // a backend field — cheap, since GET /workspaces already
                      // joins boards and a count projection adds no round trip.
                      <span
                        className={`truncate text-[13px] text-left ${
                          active ? "font-medium text-text" : "text-text-muted"
                        }`}
                      >
                        {board.name}
                      </span>
                    )}
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
