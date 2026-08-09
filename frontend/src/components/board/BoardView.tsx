"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HubConnection, HubConnectionState } from "@microsoft/signalr";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useAuth } from "@/lib/auth";
import { api, BoardDetailResponse, CardResponse } from "@/lib/api";
import {
  createBoardHubConnection,
  type CursorUpdate,
  type OperationBroadcast,
  type PresenceUser,
  type ResyncResult,
} from "@/lib/signalr";
import { applyOperation, moveCardOptimistic } from "@/lib/boardReducer";
import { friendlyError } from "@/lib/errorMessage";
import { useSeenOnce } from "@/lib/useSeenOnce";
import { BOARD_TOUR } from "@/lib/boardTour";
import { Walkthrough } from "@/components/onboarding/Walkthrough";
import { BoardColumn } from "@/components/board/BoardColumn";
import { ActivityPanel } from "@/components/board/ActivityPanel";
import { BoardIntro } from "@/components/board/BoardIntro";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { KanbanCard } from "@/components/board/KanbanCard";
import { CardDetailPanel } from "@/components/board/CardDetailPanel";
import { PresenceAvatars } from "@/components/board/PresenceAvatars";
import { RemoteCursors } from "@/components/board/RemoteCursors";
import { ReconnectingBanner } from "@/components/board/ReconnectingBanner";
import { Button } from "@/components/ui/Button";
import { UserMenu } from "@/components/ui/UserMenu";
import { TangramMark } from "@/components/ui/TangramMark";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const CURSOR_SEND_INTERVAL_MS = 50;

// The card is one element carrying two verbs, so the keys have to be split:
// Enter opens it, Space picks it up. dnd-kit preventDefaults whatever is listed
// in `start`, and that is precisely what stops Space from also firing the
// button's implicit click. Leaving Enter in `start` (the default) would mean a
// keyboard user could move cards but never open one.
const DRAG_KEYS = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter", "Tab"],
};

const DRAG_INSTRUCTIONS = {
  draggable:
    "Press enter to open this card. Press the space bar to pick it up, then use the arrow keys to move it between positions and columns. Press space again to drop it, or escape to cancel.",
};

function resolveMove(
  board: BoardDetailResponse,
  activeId: string,
  overId: string
): { targetColumnId: string; beforeCardId: string | null } | null {
  const sourceColumn = board.columns.find((col) => col.cards.some((c) => c.id === activeId));
  if (!sourceColumn) return null;

  if (overId.startsWith("column:")) {
    return { targetColumnId: overId.slice("column:".length), beforeCardId: null };
  }

  const destColumn = board.columns.find((col) => col.cards.some((c) => c.id === overId));
  if (!destColumn) return null;

  return { targetColumnId: destColumn.id, beforeCardId: overId };
}

export function BoardView({ boardId }: { boardId: string }) {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [board, setBoard] = useState<BoardDetailResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  // Fatal: the board could not be loaded at all. Blocks the surface.
  const [loadError, setLoadError] = useState<{ message: string; canRetry: boolean } | null>(null);
  // Non-fatal: one action failed. Shown inline, dismissible, never blocks (S3.6).
  const [actionError, setActionError] = useState<{ message: string; retry?: () => void } | null>(
    null
  );
  // Drives the "still waking" copy below (S2.4).
  const [slowLoad, setSlowLoad] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  // The name of a column whose create is still in flight, or null.
  const [pendingColumn, setPendingColumn] = useState<string | null>(null);
  // Set once, by the introduction's call to action. Latching rather than
  // toggling: if the user opens the form and cancels, it must not spring open
  // again on the next render.
  const [autoAddFirstCard, setAutoAddFirstCard] = useState(false);
  // On demand only -- see the reasoning in lib/boardTour.ts.
  const [tourOpen, setTourOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<CardResponse | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardResponse | null>(null);
  const [presentUsers, setPresentUsers] = useState<PresenceUser[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorUpdate>>({});

  const connectionRef = useRef<HubConnection | null>(null);
  const lastSeenSeqRef = useRef(0);
  const lastCursorSentRef = useRef(0);
  const boardAreaRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: DRAG_KEYS,
    })
  );

  // The caller's own role, from the board payload. Viewers still get presence,
  // cursors and live updates -- they just can't originate a mutation, so the
  // controls that would 403 are removed rather than shown and rejected.
  const canEdit = board !== null && board.role !== "Viewer";

  const intro = useSeenOnce("board-intro");
  // Narrow on purpose. A board with columns but no cards is the state the
  // bootstrap leaves behind, and only there does a demonstration of collaboration
  // make sense: on a board with real work on it the phantom card reads as a bug,
  // and a viewer can't act on anything it suggests.
  const showIntro =
    intro.state === "unseen" &&
    canEdit &&
    board !== null &&
    board.columns.length >= 2 &&
    board.columns.every((c) => c.cards.length === 0);

  // Cmd/Ctrl+Z opens the activity panel rather than undoing outright. Undo here
  // is a server round trip that everyone else sees immediately, so a keystroke
  // that fires it blind -- with no way to check what it caught -- is the wrong
  // trade. The panel names the change first.
  useEffect(() => {
    if (!canEdit) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;

      // Never steal undo from a field the user is typing in -- there the
      // browser's own text undo is what they mean.
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;

      e.preventDefault();
      setActivityOpen(true);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canEdit]);

  // Signing out navigates away on its own, so this covers the other way a
  // session ends: a token revoked or expired elsewhere. Without it the board
  // just sat there unable to load anything.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // The hosted API sleeps after 15 minutes idle and takes 30-60s to wake. A
  // bare "Loading board…" sitting there reads as frozen, so after a few seconds
  // say what is actually happening (S2.4).
  useEffect(() => {
    if (board || loadError) return;
    const timer = setTimeout(() => setSlowLoad(true), 4000);
    return () => clearTimeout(timer);
  }, [board, loadError]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    function applyOp(op: OperationBroadcast) {
      lastSeenSeqRef.current = Math.max(lastSeenSeqRef.current, op.seq);
      setBoard((prev) => (prev ? applyOperation(prev, op.opType, op.payload) : prev));
    }

    async function resyncAfterReconnect(connection: HubConnection) {
      try {
        await connection.invoke("JoinBoard", boardId);
        const result = await connection.invoke<ResyncResult>("Resync", boardId, lastSeenSeqRef.current);
        if (result.needsSnapshot) {
          const token = await getToken();
          const fresh = await api.get<BoardDetailResponse>(`/boards/${boardId}`, token);
          lastSeenSeqRef.current = fresh.seq;
          setBoard(fresh);
        } else {
          for (const op of result.operations) applyOp(op);
        }
      } finally {
        setReconnecting(false);
        setConnected(true);
      }
    }

    async function connect() {
      let connection: HubConnection | null = null;
      try {
        const token = await getToken();
        const detail = await api.get<BoardDetailResponse>(`/boards/${boardId}`, token);
        if (cancelled) return;
        setBoard(detail);
        lastSeenSeqRef.current = detail.seq;

        connection = createBoardHubConnection(getToken);

        connection.on("operation", applyOp);

        connection.on("presence.join", (presenceUser: PresenceUser) => {
          setPresentUsers((prev) =>
            prev.some((p) => p.userId === presenceUser.userId) ? prev : [...prev, presenceUser]
          );
        });
        connection.on("presence.leave", (presenceUser: PresenceUser) => {
          setPresentUsers((prev) => prev.filter((p) => p.userId !== presenceUser.userId));
          setRemoteCursors((prev) => {
            const next = { ...prev };
            delete next[presenceUser.userId];
            return next;
          });
        });
        connection.on("cursor", (cursor: CursorUpdate) => {
          setRemoteCursors((prev) => ({ ...prev, [cursor.userId]: cursor }));
        });

        connection.onreconnecting(() => {
          setConnected(false);
          setReconnecting(true);
        });
        connection.onreconnected(() => resyncAfterReconnect(connection!));

        await connection.start();
        if (cancelled) {
          // React StrictMode's dev-mode double-invoke can unmount this effect
          // before start() resolves -- don't join the board group on a
          // connection we're about to discard.
          await connection.stop();
          return;
        }

        connectionRef.current = connection;
        const initialPresence = await connection.invoke<PresenceUser[]>("JoinBoard", boardId);
        if (cancelled) return;
        setPresentUsers(initialPresence);
        setConnected(true);
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err, "open this board"));
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (connectionRef.current?.state === HubConnectionState.Connected) {
        connectionRef.current.stop();
      }
    };
  }, [boardId, user, getToken, reloadKey]);

  function handlePointerMove(e: React.MouseEvent<HTMLDivElement>) {
    // Gated on `connected` (set only once JoinBoard resolves), not just the
    // transport state -- start() can report "Connected" before the server
    // has associated this connection with a board, in which case Context.Items
    // isn't populated yet and UpdateCursor would silently no-op.
    if (!connected) return;

    const now = Date.now();
    if (now - lastCursorSentRef.current < CURSOR_SEND_INTERVAL_MS) return;
    lastCursorSentRef.current = now;

    const connection = connectionRef.current;
    if (!connection || connection.state !== HubConnectionState.Connected || !boardAreaRef.current) return;

    const rect = boardAreaRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // A dropped cursor frame is not worth interrupting anyone over, but a
    // connection that can no longer accept invokes is: previously both looked
    // identical and the header kept claiming "Synced" (S3.6).
    connection.invoke("UpdateCursor", x, y).catch(() => {
      if (connectionRef.current?.state !== HubConnectionState.Connected) setConnected(false);
    });
  }

  /**
   * Every board mutation goes through here (S3.6). Before this, all seven
   * handlers had no catch at all: a rejected request went nowhere, the user saw
   * their change simply not happen, and nothing said why.
   *
   * `optimistic` applies the change immediately and is rolled back to the
   * snapshot on failure (S7.1, S7.2) -- the authoritative broadcast reconciles
   * it moments later either way.
   */
  async function runMutation(
    description: string,
    send: () => Promise<unknown>,
    optimistic?: (current: BoardDetailResponse) => BoardDetailResponse
  ) {
    const snapshot = board;
    if (optimistic && snapshot) setBoard(optimistic(snapshot));
    setActionError(null);

    try {
      await send();
    } catch (err) {
      if (optimistic && snapshot) setBoard(snapshot);
      const { message, canRetry } = friendlyError(err, description);
      setActionError({
        message,
        // Only offer a retry when repeating the request could plausibly work
        // (S3.5) -- a 403 will fail identically every time.
        retry: canRetry ? () => runMutation(description, send, optimistic) : undefined,
      });
    }
  }

  async function handleAddCard(columnId: string, title: string) {
    await runMutation("add that card", async () =>
      api.post(`/boards/${boardId}/columns/${columnId}/cards`, await getToken(), { title })
    );
  }

  async function handleAddColumn(name: string) {
    setPendingColumn(name);
    try {
      await runMutation("add that column", async () =>
        api.post(`/boards/${boardId}/columns`, await getToken(), { name })
      );
    } finally {
      setPendingColumn(null);
    }
  }

  async function handleRenameColumn(columnId: string, name: string) {
    await runMutation(
      "rename that column",
      async () => api.patch(`/boards/${boardId}/columns/${columnId}`, await getToken(), { name }),
      (current) => ({
        ...current,
        columns: current.columns.map((c) => (c.id === columnId ? { ...c, name } : c)),
      })
    );
  }

  async function handleDeleteColumn(columnId: string) {
    const column = board?.columns.find((c) => c.id === columnId);
    const cardCount = column?.cards.length ?? 0;

    const confirmed = await confirm({
      title: `Delete "${column?.name ?? "this column"}"?`,
      body:
        cardCount > 0
          ? `Its ${cardCount} ${cardCount === 1 ? "card" : "cards"} will be deleted too. Everyone on the board sees this immediately, and it can't be undone.`
          : "Everyone on the board sees this immediately, and it can't be undone.",
      confirmLabel: "Delete column",
      tone: "danger",
    });
    if (!confirmed) return;

    await runMutation(
      "delete that column",
      async () => api.delete(`/boards/${boardId}/columns/${columnId}`, await getToken()),
      (current) => ({ ...current, columns: current.columns.filter((c) => c.id !== columnId) })
    );
  }

  async function handleRenameCard(cardId: string, title: string, description: string | null) {
    await runMutation(
      "save that card",
      async () =>
        api.patch(`/boards/${boardId}/cards/${cardId}`, await getToken(), { title, description }),
      (current) => ({
        ...current,
        columns: current.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => (c.id === cardId ? { ...c, title, description } : c)),
        })),
      })
    );
  }

  async function handleDeleteCard(cardId: string) {
    setSelectedCard(null);
    await runMutation(
      "delete that card",
      async () => api.delete(`/boards/${boardId}/cards/${cardId}`, await getToken()),
      (current) => ({
        ...current,
        columns: current.columns.map((col) => ({
          ...col,
          cards: col.cards.filter((c) => c.id !== cardId),
        })),
      })
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const card = board?.columns.flatMap((c) => c.cards).find((c) => c.id === event.active.id);
    setActiveCard(card ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over || !board || active.id === over.id) return;
    // Backstop: individual cards already refuse to start a drag for viewers,
    // but this keeps the optimistic update from ever running for one.
    if (!canEdit) return;

    const move = resolveMove(board, String(active.id), String(over.id));
    if (!move) return;

    const snapshot = board;
    setBoard(moveCardOptimistic(board, String(active.id), move.targetColumnId, move.beforeCardId));

    try {
      const token = await getToken();
      await api.post(`/boards/${boardId}/cards/${active.id}/move`, token, {
        targetColumnId: move.targetColumnId,
        beforeCardId: move.beforeCardId,
      });
    } catch (err) {
      setBoard(snapshot);
      const { message, canRetry } = friendlyError(err, "move that card");
      setActionError({ message, retry: canRetry ? () => handleDragEnd(event) : undefined });
    }
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-danger max-w-sm">{loadError.message}</p>
        {loadError.canRetry && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoadError(null);
              setSlowLoad(false);
              setReloadKey((k) => k + 1);
            }}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (!board) return <BoardSkeleton slow={slowLoad} />;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {reconnecting && <ReconnectingBanner />}

      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* The way back out. Before the home screen existed a board was a
              dead end -- you could reach one board and never a second. */}
          <Link
            href="/boards"
            aria-label="All boards"
            title="All boards"
            className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0 hover:opacity-85 transition-opacity"
          >
            <TangramMark size={14} color="var(--accent-fg)" />
          </Link>
          <Link
            href="/boards"
            className="text-xs text-text-dim hover:text-text-muted shrink-0"
          >
            Boards
          </Link>
          <span className="text-sm text-text-dim shrink-0">/</span>
          <span className="text-sm font-semibold truncate">{board.name}</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5" data-tour="sync">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background: connected ? "var(--success)" : "var(--warn)",
                animation: connected ? "sync-pulse 3s ease-in-out infinite" : undefined,
              }}
            />
            <span
              className="text-xs whitespace-nowrap"
              style={{ color: connected ? "var(--text-muted)" : "var(--warn)" }}
            >
              {connected ? "Synced" : "Connecting…"}
            </span>
          </div>

          {/* Names the reason the editing controls are missing. Without it a
              viewer just sees a board that appears to be missing features. */}
          {!canEdit && (
            <>
              <div className="w-px h-4.5 bg-border" />
              <span
                title="You have view-only access to this workspace. Ask an owner for Editor access to make changes."
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-2 border border-border text-[11px] font-medium text-text-muted whitespace-nowrap"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                  <circle cx="7" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                View only
              </span>
            </>
          )}

          <div className="w-px h-4.5 bg-border" />

          <PresenceAvatars users={presentUsers} />

          <button
            onClick={() => setActivityOpen(true)}
            data-tour="activity"
            title="Board activity (Ctrl/Cmd + Z)"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text hover:bg-surface-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5.75" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 3.9V7l2.1 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Activity
          </button>

          <Link
            data-tour="members"
            href={`/workspace/${board.workspaceId}/members`}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text hover:bg-surface-2 transition-colors whitespace-nowrap"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
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
            Members
          </Link>

          <UserMenu onShowMeAround={() => setTourOpen(true)} />
        </div>
      </header>

      {actionError && (
        <div
          role="alert"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-lg border border-danger bg-surface px-3.5 py-2.5 text-[13px] text-danger shadow-lg animate-[fade-up_0.2s_ease-out] max-w-[min(90vw,32rem)]"
        >
          <span className="flex-1">{actionError.message}</span>
          {actionError.retry && (
            <button
              onClick={() => {
                const again = actionError.retry!;
                setActionError(null);
                again();
              }}
              className="shrink-0 font-medium underline hover:no-underline cursor-pointer"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{ screenReaderInstructions: DRAG_INSTRUCTIONS }}
      >
        <div
          ref={boardAreaRef}
          onMouseMove={handlePointerMove}
          className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 relative"
        >
          <RemoteCursors cursors={remoteCursors} />

          {showIntro && (
            <BoardIntro
              boardAreaRef={boardAreaRef}
              onDismiss={intro.markSeen}
              onAddCard={() => {
                intro.markSeen();
                // Hands the user straight into the thing the demonstration was
                // about, rather than ending on a dialog and leaving them to
                // find the control themselves.
                setAutoAddFirstCard(true);
              }}
            />
          )}

          {/* S2.3: a board with no columns rendered as a lone dashed button in
              the top-left, which reads as a broken layout rather than a
              starting point. Viewers get the same explanation without the
              control they cannot use (S8.1). */}
          {board.columns.length === 0 && !addingColumn && !pendingColumn ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm font-medium">This board is empty.</p>
              <p className="text-[13px] text-text-muted max-w-xs">
                {canEdit
                  ? "Columns are the stages work moves through — To Do, In Progress, Done. Add the first one to get started."
                  : "Nobody has added any columns yet. You'll see them here as soon as someone does."}
              </p>
              {canEdit && (
                <Button size="sm" onClick={() => setAddingColumn(true)} disabled={!connected}>
                  Add the first column
                </Button>
              )}
            </div>
          ) : (
          <div className="flex items-start gap-3.5 h-full" data-tour="columns">
            {board.columns.map((column, i) => (
              <BoardColumn
                key={column.id}
                column={column}
                colorIndex={i}
                disabled={!connected}
                canEdit={canEdit}
                startAdding={autoAddFirstCard && i === 0}
                tourAnchors={i === 0}
                onAddCard={handleAddCard}
                onRenameColumn={handleRenameColumn}
                onDeleteColumn={handleDeleteColumn}
                onCardClick={setSelectedCard}
              />
            ))}

            {/* Same reasoning as the pending card: the server assigns the rank,
                so this says "on its way" rather than faking the row. */}
            {pendingColumn && (
              <div className="flex-none w-[262px] flex items-center gap-2 px-0.5 opacity-60">
                <span className="w-2 h-2 rounded-full bg-border-2 shrink-0" />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-text-dim truncate">
                  {pendingColumn}
                </span>
                <span className="text-[11px] text-text-dim">Adding…</span>
              </div>
            )}

            {canEdit &&
              (addingColumn ? (
                // S4.1: replaces window.prompt, the last native dialog in the app.
                // Escape cancels and blur commits, matching the add-card form.
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newColumnName.trim();
                    setNewColumnName("");
                    setAddingColumn(false);
                    if (name) handleAddColumn(name);
                  }}
                  className="flex-none w-[180px] flex flex-col gap-2"
                >
                  <input
                    autoFocus
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setNewColumnName("");
                        setAddingColumn(false);
                      }
                    }}
                    placeholder="Column name"
                    aria-label="New column name"
                    className="w-full py-2 px-3 bg-surface border border-border rounded-lg text-[13px] text-text placeholder:text-text-dim transition-colors focus-visible:border-accent"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={!newColumnName.trim()}>
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNewColumnName("");
                        setAddingColumn(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setAddingColumn(true)}
                  disabled={!connected}
                  className="flex-none w-[180px] flex items-center gap-1.5 px-3 py-2 rounded-lg border-[1.5px] border-dashed border-border text-text-dim text-xs font-medium hover:border-accent hover:text-accent cursor-pointer disabled:opacity-50"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Add column
                </button>
              ))}
          </div>
          )}
        </div>

        <DragOverlay>
          {activeCard && (
            // Lifted off the board while it travels, so the card under the
            // cursor is clearly the one being moved and not a duplicate.
            <div className="rotate-2 shadow-lg rounded-[8px] cursor-grabbing">
              <KanbanCard card={activeCard} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardDetailPanel
          card={selectedCard}
          readOnly={!canEdit}
          onClose={() => setSelectedCard(null)}
          onSave={(title, description) => handleRenameCard(selectedCard.id, title, description)}
          onDelete={() => handleDeleteCard(selectedCard.id)}
        />
      )}

      {activityOpen && (
        <ActivityPanel
          boardId={boardId}
          // Every mutation from anyone advances this, so passing it makes the
          // feed follow the board without polling for changes.
          boardSeq={board.seq}
          canEdit={canEdit}
          getToken={getToken}
          onClose={() => setActivityOpen(false)}
          onUndone={() => setSelectedCard(null)}
        />
      )}

      {tourOpen && <Walkthrough steps={BOARD_TOUR} onFinish={() => setTourOpen(false)} />}

      {dialog}
    </div>
  );
}
