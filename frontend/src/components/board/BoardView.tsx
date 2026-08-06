"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HubConnection, HubConnectionState } from "@microsoft/signalr";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import { BoardColumn } from "@/components/board/BoardColumn";
import { KanbanCard } from "@/components/board/KanbanCard";
import { CardDetailPanel } from "@/components/board/CardDetailPanel";
import { PresenceAvatars } from "@/components/board/PresenceAvatars";
import { RemoteCursors } from "@/components/board/RemoteCursors";
import { ReconnectingBanner } from "@/components/board/ReconnectingBanner";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { UserMenu } from "@/components/ui/UserMenu";
import { TangramMark } from "@/components/ui/TangramMark";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const CURSOR_SEND_INTERVAL_MS = 50;

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
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardResponse | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardResponse | null>(null);
  const [presentUsers, setPresentUsers] = useState<PresenceUser[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorUpdate>>({});

  const connectionRef = useRef<HubConnection | null>(null);
  const lastSeenSeqRef = useRef(0);
  const lastCursorSentRef = useRef(0);
  const boardAreaRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // The caller's own role, from the board payload. Viewers still get presence,
  // cursors and live updates -- they just can't originate a mutation, so the
  // controls that would 403 are removed rather than shown and rejected.
  const canEdit = board !== null && board.role !== "Viewer";

  // Signing out navigates away on its own, so this covers the other way a
  // session ends: a token revoked or expired elsewhere. Without it the board
  // just sat there unable to load anything.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

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
      } catch {
        if (!cancelled) setError("Couldn't connect to the board. Is the backend running?");
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (connectionRef.current?.state === HubConnectionState.Connected) {
        connectionRef.current.stop();
      }
    };
  }, [boardId, user, getToken]);

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
    connection.invoke("UpdateCursor", x, y).catch(() => {});
  }

  async function handleAddCard(columnId: string, title: string) {
    const token = await getToken();
    await api.post(`/boards/${boardId}/columns/${columnId}/cards`, token, { title });
  }

  async function handleAddColumn() {
    const name = window.prompt("Column name?");
    if (!name?.trim()) return;
    const token = await getToken();
    await api.post(`/boards/${boardId}/columns`, token, { name: name.trim() });
  }

  async function handleRenameColumn(columnId: string, name: string) {
    const token = await getToken();
    await api.patch(`/boards/${boardId}/columns/${columnId}`, token, { name });
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

    const token = await getToken();
    await api.delete(`/boards/${boardId}/columns/${columnId}`, token);
  }

  async function handleRenameCard(cardId: string, title: string, description: string | null) {
    const token = await getToken();
    await api.patch(`/boards/${boardId}/cards/${cardId}`, token, { title, description });
  }

  async function handleDeleteCard(cardId: string) {
    const token = await getToken();
    await api.delete(`/boards/${boardId}/cards/${cardId}`, token);
    setSelectedCard(null);
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
    } catch {
      setBoard(snapshot);
    }
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading board…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {reconnecting && <ReconnectingBanner />}

      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0">
            <TangramMark size={14} color="var(--accent-fg)" />
          </div>
          <span className="text-sm font-semibold truncate">{board.name}</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
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

          <UserMenu />

          <div className="w-px h-4.5 bg-border" />

          <Link
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

          <div className="w-px h-4.5 bg-border" />

          <ThemeToggle />
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={boardAreaRef}
          onMouseMove={handlePointerMove}
          className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 relative"
        >
          <RemoteCursors cursors={remoteCursors} />

          <div className="flex items-start gap-3.5 h-full">
            {board.columns.map((column, i) => (
              <BoardColumn
                key={column.id}
                column={column}
                colorIndex={i}
                disabled={!connected}
                canEdit={canEdit}
                onAddCard={handleAddCard}
                onRenameColumn={handleRenameColumn}
                onDeleteColumn={handleDeleteColumn}
                onCardClick={setSelectedCard}
              />
            ))}

            {canEdit && (
              <button
                onClick={handleAddColumn}
                disabled={!connected}
                className="flex-none w-[180px] flex items-center gap-1.5 px-3 py-2 rounded-lg border-[1.5px] border-dashed border-border text-text-dim text-xs font-medium hover:border-accent hover:text-accent cursor-pointer disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add column
              </button>
            )}
          </div>
        </div>

        <DragOverlay>{activeCard && <KanbanCard card={activeCard} />}</DragOverlay>
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

      {dialog}
    </div>
  );
}
