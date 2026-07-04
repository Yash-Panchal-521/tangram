"use client";

import { useEffect, useRef, useState } from "react";
import { HubConnection, HubConnectionState } from "@microsoft/signalr";
import { useAuth } from "@/lib/auth";
import { api, BoardDetailResponse, CardResponse } from "@/lib/api";
import { createBoardHubConnection, OperationBroadcast } from "@/lib/signalr";
import { BoardColumn } from "@/components/board/BoardColumn";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { TangramMark } from "@/components/ui/TangramMark";

export function BoardView({ boardId }: { boardId: string }) {
  const { user, getToken } = useAuth();
  const [board, setBoard] = useState<BoardDetailResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<HubConnection | null>(null);

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
          if (op.opType !== "card.create") return;
          const card = op.payload as CardResponse;
          setBoard((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              columns: prev.columns.map((col) =>
                col.id === card.columnId ? { ...col, cards: [...col.cards, card] } : col
              ),
            };
          });
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
    <div className="flex-1 flex flex-col overflow-hidden">
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

      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-5">
        <div className="flex items-start gap-3.5 h-full">
          {board.columns.map((column, i) => (
            <BoardColumn
              key={column.id}
              column={column}
              colorIndex={i}
              disabled={!connected}
              onAddCard={handleAddCard}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
