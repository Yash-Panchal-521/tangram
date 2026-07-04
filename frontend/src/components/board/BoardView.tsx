"use client";

import { useEffect, useRef, useState } from "react";
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
import { createBoardHubConnection, OperationBroadcast } from "@/lib/signalr";
import { applyOperation, moveCardOptimistic } from "@/lib/boardReducer";
import { BoardColumn } from "@/components/board/BoardColumn";
import { KanbanCard } from "@/components/board/KanbanCard";
import { CardDetailPanel } from "@/components/board/CardDetailPanel";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { TangramMark } from "@/components/ui/TangramMark";

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
  const { user, getToken } = useAuth();
  const [board, setBoard] = useState<BoardDetailResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<CardResponse | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardResponse | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function connect() {
      try {
        const token = await getToken();
        const detail = await api.get<BoardDetailResponse>(`/boards/${boardId}`, token);
        if (cancelled) return;
        setBoard(detail);

        const connection = createBoardHubConnection(getToken);
        connectionRef.current = connection;

        connection.on("operation", (op: OperationBroadcast) => {
          setBoard((prev) => (prev ? applyOperation(prev, op.opType, op.payload) : prev));
        });

        connection.onreconnecting(() => setConnected(false));
        connection.onreconnected(() => setConnected(true));

        await connection.start();
        await connection.invoke("JoinBoard", boardId);
        if (!cancelled) setConnected(true);
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
    if (!window.confirm("Delete this column and all its cards?")) return;
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

          <div className="w-px h-4.5 bg-border" />

          {user && <Avatar name={user.displayName ?? user.email ?? "You"} size="sm" />}

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
        <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5">
          <div className="flex items-start gap-3.5 h-full">
            {board.columns.map((column, i) => (
              <BoardColumn
                key={column.id}
                column={column}
                colorIndex={i}
                disabled={!connected}
                onAddCard={handleAddCard}
                onRenameColumn={handleRenameColumn}
                onDeleteColumn={handleDeleteColumn}
                onCardClick={setSelectedCard}
              />
            ))}

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
          </div>
        </div>

        <DragOverlay>{activeCard && <KanbanCard card={activeCard} />}</DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardDetailPanel
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onSave={(title, description) => handleRenameCard(selectedCard.id, title, description)}
          onDelete={() => handleDeleteCard(selectedCard.id)}
        />
      )}
    </div>
  );
}
