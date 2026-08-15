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
/**
 * One figure in the summary row.
 *
 * The number is set in the display face at 30px and the label in 10px caps
 * beneath it, so the row reads as quantities first and categories second —
 * which is the order you scan a summary in.
 */
function Stat({ n, k }: { n: number; k: string }) {
  return (
    <div>
      <div
        className="text-[30px] leading-none tabular-nums"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {n}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.11em] text-text-dim">{k}</div>
    </div>
  );
}

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
        {/* No mark. The sidebar carries it, along with the workspace and
            every board — repeating it here would be repeating it. The header
            says which page this is and nothing else. */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold truncate">Your boards</span>
        </div>
        <UserMenu />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1140px] w-full px-11 pt-11 pb-14 flex flex-col gap-12">
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
                <section key={workspace.id} className="flex flex-col">
                  {/* The kicker names what kind of thing the title is. Without
                      it a bare workspace name at display size reads as the
                      product's own name rather than as one of several. */}
                  <p className="text-[10px] uppercase tracking-[0.14em] text-text-dim">Workspace</p>
                  <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                    <h2
                      className="text-[40px] leading-none tracking-[-0.014em] truncate"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {workspace.name}
                    </h2>
                    <Badge tone={isOwner ? "accent" : "neutral"}>{workspace.role}</Badge>
                    <div className="flex-1" />
                    <Link
                      href={`/workspace/${workspace.id}/members`}
                      className="text-[12.5px] font-medium text-text-muted hover:text-text hover:underline"
                    >
                      Members
                    </Link>
                  </div>

                  {/* Counts, then a rule in --text rather than a hairline: this
                      separates the workspace's summary from its contents, and a
                      hairline there reads as just another row divider. */}
                  <div className="flex gap-[34px] mt-6 pb-[22px] border-b border-text">
                    <Stat n={active.length} k={active.length === 1 ? "Board" : "Boards"} />
                    {archived.length > 0 && <Stat n={archived.length} k="Archived" />}
                  </div>


                  {visible.length === 0 ? (
                    <p className="py-8 text-[13px] text-text-dim">
                      {canEdit
                        ? "No boards here yet. Create one to get started."
                        : "No boards here yet. An owner or editor can create one."}
                    </p>
                  ) : (
                    <ul>
                      {visible.map((board, i) => (
                        <li
                          key={board.id}
                          className={`group relative grid items-center gap-5 py-5 px-1.5 border-b border-border-2 transition-colors hover:bg-surface ${
                            board.archived ? "opacity-70" : ""
                          }`}
                          style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}
                        >
                          <span
                            aria-hidden="true"
                            className="text-[22px] leading-none text-text-dim tabular-nums"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>

                          <span className="min-w-0">
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
                                  className="w-full text-base font-medium bg-surface-2 border border-border rounded-[2px] px-2 py-1 focus-visible:border-accent"
                                />
                              </form>
                            ) : (
                              <Link
                                href={`/board/${board.id}`}
                                onClick={() => openBoard(board.id)}
                                className="block text-base font-medium tracking-[-0.014em] truncate hover:text-accent"
                              >
                                {/* Stretched so the whole row is the click
                                    target, without nesting the row's buttons
                                    inside an anchor. */}
                                <span className="absolute inset-0" aria-hidden="true" />
                                {board.name}
                              </Link>
                            )}
                            <span className="block mt-[5px] text-[12.5px] text-text-dim">
                              {board.archived ? "Archived · " : ""}
                              updated {relativeTime(board.updatedAt)}
                            </span>
                          </span>

                          {canEdit && renamingId !== board.id && (
                            // Above the stretched link, or the row's own anchor
                            // swallows these clicks.
                            <span className="relative z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              {!board.archived && (
                                <button
                                  onClick={() => {
                                    setRenameValue(board.name);
                                    setRenamingId(board.id);
                                  }}
                                  disabled={busyBoardId === board.id}
                                  aria-label={`Rename ${board.name}`}
                                  className="px-1.5 py-0.5 rounded-[2px] text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer disabled:opacity-50"
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
                                    className="px-1.5 py-0.5 rounded-[2px] text-[11px] font-medium text-accent hover:bg-surface-2 cursor-pointer disabled:opacity-50"
                                  >
                                    Restore
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => void handleArchive(board.id, board.name)}
                                    disabled={busyBoardId === board.id}
                                    aria-label={`Archive ${board.name}`}
                                    className="px-1.5 py-0.5 rounded-[2px] text-[11px] font-medium text-text-muted hover:text-danger hover:bg-surface-2 cursor-pointer disabled:opacity-50"
                                  >
                                    Archive
                                  </button>
                                ))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* A row, not a button floating above the list. It is the last
                      entry in the same sequence, so it carries the same 44px
                      number column — the "+" sits where a number would, and the
                      form that replaces it keeps the row's shape rather than
                      appearing somewhere else on the page. */}
                  {canEdit &&
                    (creatingIn === workspace.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleCreate(workspace.id);
                        }}
                        className="grid items-center gap-5 w-full py-5 px-1.5 border-b border-border-2"
                        style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}
                      >
                        <span
                          aria-hidden="true"
                          className="text-[20px] leading-none text-text-dim"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          +
                        </span>
                        {/* Underlined, not boxed — the v7 field. A box here
                            would be the only one on a page built from rules. */}
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
                          data-focus-ring="none"
                          className="w-full bg-transparent border-b border-border pb-1 text-base font-medium text-text placeholder:text-text-dim focus-visible:border-accent focus-visible:shadow-[inset_0_-1px_0_0_var(--accent)] outline-none"
                        />
                        <span className="flex items-center gap-1">
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
                        </span>
                      </form>
                    ) : (
                      <button
                        onClick={() => setCreatingIn(workspace.id)}
                        className="grid items-center gap-5 w-full py-5 px-1.5 border-b border-border-2 text-[13.5px] text-text-dim hover:text-text cursor-pointer text-left"
                        style={{ gridTemplateColumns: "44px minmax(0,1fr)" }}
                      >
                        <span
                          aria-hidden="true"
                          className="text-[20px] leading-none"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          +
                        </span>
                        <span>New board</span>
                      </button>
                    ))}
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
