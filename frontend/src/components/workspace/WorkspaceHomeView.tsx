"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api, type BoardResponse, type WorkspaceSummaryResponse } from "@/lib/api";
import { friendlyError } from "@/lib/errorMessage";
import { relativeTime } from "@/lib/relativeTime";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { TangramMark } from "@/components/ui/TangramMark";
import { UserMenu } from "@/components/ui/UserMenu";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const LAST_BOARD_KEY = "tangram-board-id";

function WorkspaceSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading your workspaces…</span>
      <Skeleton className="h-3.5 w-40 rounded" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * The home screen: every workspace you belong to and the boards inside it.
 *
 * Until this existed, `/board` opened your first board and there was no way to
 * have or reach a second — so the multi-tenant model the backend enforces was
 * invisible from the app. This is the surface that makes it real.
 */
export function WorkspaceHomeView() {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyBoardId, setBusyBoardId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    setWorkspaces(await api.get<WorkspaceSummaryResponse[]>("/workspaces", token));
  }, [getToken]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const next = await api.get<WorkspaceSummaryResponse[]>("/workspaces", token);
        if (!cancelled) {
          setWorkspaces(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, "load your workspaces").message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, getToken]);

  async function run(description: string, action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(friendlyError(err, description).message);
    }
  }

  async function handleCreate(workspaceId: string) {
    const name = newBoardName.trim();
    if (!name) return;
    setNewBoardName("");
    setCreatingIn(null);
    setBusyBoardId(workspaceId);
    await run("create that board", async () => {
      const created = await api.post<BoardResponse>(
        `/workspaces/${workspaceId}/boards`,
        await getToken(),
        { name }
      );
      // Straight into it. Creating a board and then being left on a list to
      // find it is a step nobody wants.
      router.push(`/board/${created.id}`);
    });
    setBusyBoardId(null);
  }

  async function handleRename(boardId: string, currentName: string) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === currentName) return;
    setBusyBoardId(boardId);
    await run("rename that board", async () =>
      api.patch(`/boards/${boardId}`, await getToken(), { name })
    );
    setBusyBoardId(null);
  }

  async function handleArchive(boardId: string, name: string) {
    const confirmed = await confirm({
      title: `Archive “${name}”?`,
      body: "It leaves the board list but keeps everything on it. Any owner can bring it back at any time.",
      confirmLabel: "Archive board",
    });
    if (!confirmed) return;

    setBusyBoardId(boardId);
    await run("archive that board", async () =>
      api.post(`/boards/${boardId}/archive`, await getToken(), {})
    );
    setBusyBoardId(null);
  }

  async function handleUnarchive(boardId: string) {
    setBusyBoardId(boardId);
    await run("restore that board", async () =>
      api.post(`/boards/${boardId}/unarchive`, await getToken(), {})
    );
    setBusyBoardId(null);
  }

  function openBoard(boardId: string) {
    try {
      window.localStorage.setItem(LAST_BOARD_KEY, boardId);
    } catch {
      // Only a convenience for the next sign-in; the landing page validates it
      // against the server anyway.
    }
  }

  const archivedCount =
    workspaces?.reduce((n, w) => n + w.boards.filter((b) => b.archived).length, 0) ?? 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0">
            <TangramMark size={14} color="var(--accent-fg)" />
          </div>
          <span className="text-sm font-semibold truncate">Your boards</span>
        </div>
        <UserMenu />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl w-full px-6 py-8 flex flex-col gap-8">
          {actionError && (
            <p role="alert" className="text-[13px] text-danger">
              {actionError}
            </p>
          )}

          {error ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-danger max-w-sm">{error}</p>
              <Button variant="secondary" size="sm" onClick={() => location.reload()}>
                Try again
              </Button>
            </div>
          ) : workspaces === null ? (
            <WorkspaceSkeleton />
          ) : workspaces.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm font-medium">You&apos;re not in a workspace yet.</p>
              <p className="text-[13px] text-text-muted max-w-sm">
                Sign in again to have one set up for you, or ask a teammate to invite you to theirs.
              </p>
            </div>
          ) : (
            workspaces.map((workspace) => {
              const isOwner = workspace.role === "Owner";
              const canEdit = workspace.role !== "Viewer";
              const active = workspace.boards.filter((b) => !b.archived);
              const archived = workspace.boards.filter((b) => b.archived);
              const visible = showArchived ? [...active, ...archived] : active;

              return (
                <section key={workspace.id} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-[15px] font-semibold truncate">{workspace.name}</h2>
                    <Badge tone={isOwner ? "accent" : "neutral"}>{workspace.role}</Badge>
                    <div className="flex-1" />
                    <Link
                      href={`/workspace/${workspace.id}/members`}
                      className="text-xs font-medium text-text-muted hover:text-text hover:underline"
                    >
                      Members
                    </Link>
                    {canEdit && creatingIn !== workspace.id && (
                      <Button size="sm" variant="secondary" onClick={() => setCreatingIn(workspace.id)}>
                        New board
                      </Button>
                    )}
                  </div>

                  {creatingIn === workspace.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleCreate(workspace.id);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={newBoardName}
                        onChange={(e) => setNewBoardName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setNewBoardName("");
                            setCreatingIn(null);
                          }
                        }}
                        placeholder="Board name"
                        aria-label={`New board in ${workspace.name}`}
                        className="flex-1 py-2 px-3 bg-surface border border-border rounded-lg text-[13px] text-text placeholder:text-text-dim focus-visible:border-accent"
                      />
                      <Button type="submit" size="sm" disabled={!newBoardName.trim()}>
                        Create
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setNewBoardName("");
                          setCreatingIn(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </form>
                  )}

                  {visible.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-text-dim">
                      {canEdit
                        ? "No boards here yet. Create one to get started."
                        : "No boards here yet. An owner or editor can create one."}
                    </p>
                  ) : (
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {visible.map((board) => (
                        <li
                          key={board.id}
                          className={`group relative rounded-xl border bg-surface p-4 transition-shadow ${
                            board.archived
                              ? "border-dashed border-border opacity-70"
                              : "border-border hover:shadow-[0_3px_14px_rgba(0,0,0,0.08)] hover:border-border-2"
                          }`}
                        >
                          {renamingId === board.id ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleRename(board.id, board.name);
                              }}
                            >
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => void handleRename(board.id, board.name)}
                                onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                                aria-label={`Rename ${board.name}`}
                                className="w-full text-[13px] font-medium bg-surface-2 border border-border rounded px-2 py-1 focus-visible:border-accent"
                              />
                            </form>
                          ) : (
                            <Link
                              href={`/board/${board.id}`}
                              onClick={() => openBoard(board.id)}
                              className="text-[13px] font-medium hover:text-accent"
                            >
                              {/* Stretched so the whole card is the click
                                  target, without nesting the row's buttons
                                  inside an anchor. */}
                              <span className="absolute inset-0 rounded-xl" aria-hidden="true" />
                              {board.name}
                            </Link>
                          )}

                          <p className="text-[11px] text-text-dim mt-1">
                            {board.archived ? "Archived · " : ""}
                            updated {relativeTime(board.updatedAt)}
                          </p>

                          {canEdit && renamingId !== board.id && (
                            <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              {!board.archived && (
                                <button
                                  onClick={() => {
                                    setRenameValue(board.name);
                                    setRenamingId(board.id);
                                  }}
                                  disabled={busyBoardId === board.id}
                                  aria-label={`Rename ${board.name}`}
                                  className="px-1.5 py-0.5 rounded text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer disabled:opacity-50"
                                >
                                  Rename
                                </button>
                              )}
                              {/* Owner-only: archiving changes what the whole
                                  workspace sees, so it sits with the other
                                  membership-shaped decisions (S8.1 — removed
                                  for the role, not disabled). */}
                              {isOwner &&
                                (board.archived ? (
                                  <button
                                    onClick={() => void handleUnarchive(board.id)}
                                    disabled={busyBoardId === board.id}
                                    aria-label={`Restore ${board.name}`}
                                    className="px-1.5 py-0.5 rounded text-[11px] font-medium text-accent hover:bg-surface-2 cursor-pointer disabled:opacity-50"
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => void handleArchive(board.id, board.name)}
                                    disabled={busyBoardId === board.id}
                                    aria-label={`Archive ${board.name}`}
                                    className="px-1.5 py-0.5 rounded text-[11px] font-medium text-text-muted hover:text-danger hover:bg-surface-2 cursor-pointer disabled:opacity-50"
                                  >
                                    Archive
                                  </button>
                                ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}

          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="self-start text-xs font-medium text-text-muted hover:text-text underline cursor-pointer"
            >
              {showArchived
                ? "Hide archived boards"
                : `Show ${archivedCount} archived board${archivedCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      {dialog}
    </div>
  );
}
