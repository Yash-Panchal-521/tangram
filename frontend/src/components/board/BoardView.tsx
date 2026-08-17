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
import {
  api,
  type BoardDetailResponse,
  type CardResponse,
  type CommentResponse,
  type LabelColor,
  type MeResponse,
  type LabelResponse,
  type CreateCardRequest,
  type MemberResponse,
  type SetColumnLimitsRequest,
  type UpdateCardRequest,
  type WorkspaceMembersResponse,
} from "@/lib/api";
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
import { useCardParam } from "@/lib/useCardParam";
import { useBoardFilter } from "@/lib/useBoardFilter";
import { BoardFilterBar } from "@/components/board/BoardFilterBar";
import { CreateCardDialog } from "@/components/board/CreateCardDialog";
import { SeedColumnsDialog } from "@/components/board/SeedColumnsDialog";
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import { countMatches, filterBoard, isFilterActive } from "@/lib/boardFilter";
import { lanesFor, type LaneView } from "@/lib/boardLanes";
import { parseCellId, resolveLaneDrop } from "@/lib/laneDrop";
import { BOARD_TOUR } from "@/lib/boardTour";
import { Walkthrough } from "@/components/onboarding/Walkthrough";
import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardLanes } from "@/components/board/BoardLanes";
import { BoardIntro } from "@/components/board/BoardIntro";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { KanbanCard } from "@/components/board/KanbanCard";
import { CardDetailModal } from "@/components/board/detail/CardDetailModal";
import { PresenceAvatars } from "@/components/board/PresenceAvatars";
import { RemoteCursors } from "@/components/board/RemoteCursors";
import { ReconnectingBanner } from "@/components/board/ReconnectingBanner";
import { Button } from "@/components/ui/Button";
import { UserMenu } from "@/components/ui/UserMenu";
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
  // The name of a column whose create is still in flight, or null.
  const [pendingColumn, setPendingColumn] = useState<string | null>(null);
  // Set once, by the introduction's call to action. Latching rather than
  // toggling: if the user opens the form and cancels, it must not spring open
  // again on the next render.
  const [autoAddFirstCard, setAutoAddFirstCard] = useState(false);
  // On demand only -- see the reasoning in lib/boardTour.ts.
  const [tourOpen, setTourOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<CardResponse | null>(null);
  // Which card is open lives in the URL — see useCardParam for why.
  const { openCardId, openCard: openCardById, closeCard } = useCardParam();
  const { filter, setFilter, clear: clearFilter } = useBoardFilter();
  const [creating, setCreating] = useState(false);
  const [seedingColumns, setSeedingColumns] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // How the board is grouped. Not in the URL, unlike the filter: a filter is
  // a thing you send someone, a grouping is how you personally like to look.
  const [laneView, setLaneView] = useState<LaneView>("status");
  // The open card's thread. Held here rather than in the modal because every
  // other piece of sync lives here, and a comment arriving from someone else is
  // a broadcast like any other -- the modal would otherwise need its own
  // connection to hear about it.
  //
  // Not in `board`: comments are unbounded, and the board carries only a count
  // so that rendering it does not mean loading every conversation on it.
  // Keyed by card, not a bare list. Clearing it in an effect when the card
  // closed was both a cascading render and a race: opening a second card showed
  // the first one's thread until the fetch landed. Tagging it means a thread is
  // simply not this card's, and renders as empty without anyone clearing it.
  const [thread, setThread] = useState<{ cardId: string; items: CommentResponse[] } | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsReload, setCommentsReload] = useState(0);
  // Workspace roster, for the assignee picker and for putting a name on the
  // avatar a card shows. Fetched once the board is known.
  const [members, setMembers] = useState<MemberResponse[]>([]);
  // Our internal id, not the Firebase uid. A comment records the former, and the
  // thread needs to know which comments are yours to offer edit and delete.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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

  // Looked up fresh on every render rather than stored, which is the whole point
  // of keeping the id rather than the card: the old panel held a *snapshot*, so
  // a broadcast that changed the open card updated the board behind it and never
  // the panel itself. Someone else's edit was invisible until you reopened it.
  const openCardValue = openCardId
    ? board?.columns.flatMap((c) => c.cards).find((c) => c.id === openCardId) ?? null
    : null;

  // Keyed by user, not just by browser. It was per-browser, and the
  // consequence was concrete: signing up a second account in a browser that had
  // already seen the introduction meant the new person got nothing -- which is
  // exactly how this app gets demonstrated.
  const intro = useSeenOnce(`board-intro:${user?.uid ?? "anon"}`);
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

  // Assignee names, keyed by user id. Anyone who has left the workspace is
  // simply absent, and the card falls back to showing no assignee rather than a
  // blank avatar nobody can identify.
  const memberNames = new Map(members.map((m) => [m.userId, m.displayName]));
  const memberRoles = new Map(members.map((m) => [m.userId, m.role as string]));

  // Pinned rather than read during render, because `Date.now()` in render is a
  // different value on every pass and "recently updated" would flicker. Ticked
  // only while that filter is on: a board left open overnight would otherwise
  // keep answering with yesterday's idea of "recent".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!filter.recent) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [filter.recent]);

  // `c` creates, which is Jira's shortcut for it. Ignored while something is
  // being typed into, or it would swallow the letter mid-word in a card title —
  // the same guard the filter bar's `/` uses.
  useEffect(() => {
    if (!canEdit) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      // Not while a card is open: `c` there is a letter someone is about to
      // type, or at best ambiguous about which board it means.
      if (openCardId) return;

      e.preventDefault();
      setCreating(true);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canEdit, openCardId]);

  // The board as the filter leaves it. Everything that draws the board reads
  // this; everything that resolves a card by id keeps reading `board`, so a
  // card open behind `?card=` stays open when a filter would have hidden it.
  const visibleBoard = board ? filterBoard(board, filter, now) : null;

  /**
   * The cards either side of the open one, for the drawer's step controls.
   *
   * Walked over the *filtered* board, not the whole one. Stepping is a way of
   * working through what you are looking at, so with a filter on it has to stay
   * inside it — otherwise the next card is one the board is not showing, and
   * closing the drawer leaves you nowhere.
   *
   * Column order, then rank within each: the order the board reads. The lane
   * views regroup the same cards, but stepping by lane would mean the arrows
   * did something different depending on a view toggle elsewhere on screen.
   */
  const stepOrder = (visibleBoard ?? board)?.columns.flatMap((c) => c.cards) ?? [];
  const stepIndex = openCardId ? stepOrder.findIndex((c) => c.id === openCardId) : -1;
  const prevCardId = stepIndex > 0 ? stepOrder[stepIndex - 1].id : null;
  const nextCardId =
    stepIndex >= 0 && stepIndex < stepOrder.length - 1 ? stepOrder[stepIndex + 1].id : null;

  const filtering = isFilterActive(filter);

  const workspaceId = board?.workspaceId;
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        // Fetched together: both are "who is who", both are non-fatal, and one
        // round trip is cheaper than two for state the board can live without.
        const [roster, me] = await Promise.all([
          api.get<WorkspaceMembersResponse>(`/workspaces/${workspaceId}/members`, token),
          api.get<MeResponse>("/me", token),
        ]);
        if (!cancelled) {
          setMembers(roster.members);
          setCurrentUserId(me.id);
        }
      } catch {
        // Non-fatal by design: without the roster the assignee picker has no
        // options and cards show no avatar, and without `me` the thread simply
        // offers nobody edit or delete. Failing the whole surface over either
        // would be worse -- and the server is the authority on both anyway.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, getToken]);

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

      // The board only carries the count; the thread itself is separate state,
      // so comment operations have to be applied to both. Replacing by id keeps
      // this idempotent like every other case -- resync replays operations a
      // client may already have applied.
      if (op.opType.startsWith("comment.")) {
        const payload = op.payload as CommentResponse & { id: string; cardId: string };
        setThread((prev) => {
          // Only the open card's thread is held, so anything else is for a card
          // nobody is reading and is dropped.
          if (!prev || prev.cardId !== payload.cardId) return prev;

          // Replacing by id keeps this idempotent like every other case --
          // resync replays operations a client may already have applied.
          const items =
            op.opType === "comment.delete"
              ? prev.items.filter((c) => c.id !== payload.id)
              : prev.items.some((c) => c.id === payload.id)
                ? prev.items.map((c) => (c.id === payload.id ? payload : c))
                : op.opType === "comment.create"
                  ? [...prev.items, payload]
                  : prev.items;

          return { ...prev, items };
        });
      }
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
    optimistic?: (current: BoardDetailResponse) => BoardDetailResponse,
    /**
     * Report the failure to the caller instead of the board-level toast.
     *
     * The card detail view saves one field at a time, so "couldn't save that
     * card" floating at the bottom of the board is the wrong place for it —
     * the field itself has to say so, next to the value that reverted (S3.2).
     * Rollback still happens here either way.
     */
    surface: "toast" | "rethrow" = "toast"
  ) {
    const snapshot = board;
    if (optimistic && snapshot) setBoard(optimistic(snapshot));
    setActionError(null);

    try {
      await send();
    } catch (err) {
      if (optimistic && snapshot) setBoard(snapshot);
      const { message, canRetry } = friendlyError(err, description);

      if (surface === "rethrow") {
        throw new Error(message);
      }

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

  async function handleCreateCard(columnId: string, request: CreateCardRequest) {
    await runMutation(
      "add that card",
      async () =>
        api.post(`/boards/${boardId}/columns/${columnId}/cards`, await getToken(), request),
      undefined,
      // Rethrown so the dialog stays open and says why (S3.2). A toast
      // behind a dialog that closed anyway is how a rejected card looks
      // created — and the text someone just typed would be gone.
      "rethrow"
    );
  }

  async function handleMoveColumn(columnId: string, beforeColumnId: string | null) {
    await runMutation(
      "reorder those columns",
      async () =>
        api.post(`/boards/${boardId}/columns/${columnId}/move`, await getToken(), {
          beforeColumnId,
        }),
      undefined,
      "rethrow"
    );
  }

  async function handleSeedColumns(names: string[]) {
    await runMutation(
      "add those columns",
      async () => api.post(`/boards/${boardId}/columns/bulk`, await getToken(), { names }),
      undefined,
      // Rethrown so the dialog stays open and says why (S3.2), and so a half
      // answer never looks accepted — the call is all-or-nothing on the server.
      "rethrow"
    );
  }

  async function handleAddColumn(name: string) {
    setPendingColumn(name);
    try {
      await runMutation(
        "add that column",
        async () => api.post(`/boards/${boardId}/columns`, await getToken(), { name }),
        undefined,
        // Rethrown: this is only reached from the settings panel now, and a
        // toast at the foot of the board sits behind that dialog's overlay
        // where nobody will read it (S3.2).
        "rethrow"
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

  async function handleSetColumnLimits(columnId: string, request: SetColumnLimitsRequest) {
    await runMutation(
      "set those limits",
      async () =>
        api.patch(`/boards/${boardId}/columns/${columnId}/limits`, await getToken(), request),
      (current) => ({
        ...current,
        columns: current.columns.map((c) =>
          c.id === columnId
            ? {
                ...c,
                minCards: request.clearMinCards ? null : (request.minCards ?? c.minCards),
                maxCards: request.clearMaxCards ? null : (request.maxCards ?? c.maxCards),
              }
            : c
        ),
      }),
      // Rethrown so the dialog can stay open and say why (S3.2). A toast behind
      // a dialog that closed anyway is how a rejected limit looks accepted.
      "rethrow"
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

  async function handleUpdateCard(cardId: string, update: UpdateCardRequest) {
    await runMutation(
      "save that card",
      async () => api.patch(`/boards/${boardId}/cards/${cardId}`, await getToken(), update),
      (current) => ({
        ...current,
        columns: current.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  title: update.title ?? c.title,
                  description: update.description ?? null,
                  // Mirrors the server's rule exactly: a clear flag wins, an
                  // omitted field is left alone. Diverging here would make the
                  // optimistic view disagree with the broadcast that follows.
                  dueAt: update.clearDueAt ? null : update.dueAt ?? c.dueAt,
                  assigneeId: update.clearAssignee ? null : update.assigneeId ?? c.assigneeId,
                  priority: update.clearPriority ? null : update.priority ?? c.priority,
                  // Set semantics, resolved against the board's vocabulary --
                  // the request carries ids and the card carries whole labels.
                  labels: update.labelIds
                    ? update.labelIds
                        .map((id) => current.labels.find((l) => l.id === id))
                        .filter((l): l is LabelResponse => l !== undefined)
                    : c.labels,
                }
              : c
          ),
        })),
      }),
      // The detail view is the only caller, and it wants the failure itself.
      "rethrow"
    );
  }

  /** Status, in the detail view's language: move the card to another column. */
  async function handleSetCardColumn(cardId: string, targetColumnId: string) {
    if (!board) return;
    const target = board.columns.find((c) => c.id === targetColumnId);
    // Appended to the end of the target, which is where a card dropped without
    // a position goes everywhere else in the app.
    const beforeCardId = null;

    await runMutation(
      "move that card",
      async () =>
        api.post(`/boards/${boardId}/cards/${cardId}/move`, await getToken(), {
          targetColumnId,
          beforeCardId,
        }),
      (current) => moveCardOptimistic(current, cardId, target?.id ?? targetColumnId, beforeCardId),
      "rethrow"
    );
  }

  // Fetched when a card opens, and again on a deliberate retry. Not part of the
  // board load: most cards on a board are not being read, and their
  // conversations are not worth the bytes.
  useEffect(() => {
    if (!openCardId) return;

    const cardId = openCardId;
    let cancelled = false;

    (async () => {
      // Set inside the async body rather than before it, so nothing is assigned
      // synchronously while the effect runs.
      setCommentsLoading(true);
      setCommentsError(null);
      try {
        const token = await getToken();
        const items = await api.get<CommentResponse[]>(
          `/boards/${boardId}/cards/${cardId}/comments`,
          token
        );
        if (!cancelled) setThread({ cardId, items });
      } catch (err) {
        if (!cancelled) setCommentsError(friendlyError(err, "load the comments").message);
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openCardId, boardId, getToken, commentsReload]);

  async function handleAddComment(body: string) {
    if (!openCardId) return;
    // No optimistic append: the server assigns the id and the timestamp, and a
    // temporary one would leave a duplicate until the broadcast replaced it --
    // the same reason a new card gets a placeholder rather than a real row.
    await runMutation(
      "add that comment",
      async () =>
        api.post(`/boards/${boardId}/cards/${openCardId}/comments`, await getToken(), { body }),
      undefined,
      "rethrow"
    );
  }

  async function handleEditComment(commentId: string, body: string) {
    await runMutation(
      "save that comment",
      async () => api.patch(`/boards/${boardId}/comments/${commentId}`, await getToken(), { body }),
      undefined,
      "rethrow"
    );
  }

  async function handleDeleteComment(commentId: string) {
    await runMutation(
      "delete that comment",
      async () => api.delete(`/boards/${boardId}/comments/${commentId}`, await getToken()),
      undefined,
      "rethrow"
    );
  }

  async function handleCreateLabel(name: string, color: LabelColor) {
    // No optimistic update: the server assigns the id, and inventing one would
    // leave a duplicate on screen until the broadcast replaced it -- the same
    // reason creating a card shows a placeholder rather than a real row.
    await runMutation(
      "add that label",
      async () => api.post(`/boards/${boardId}/labels`, await getToken(), { name, color }),
      undefined,
      "rethrow"
    );
  }

  async function handleDeleteLabel(labelId: string) {
    await runMutation(
      "delete that label",
      async () => api.delete(`/boards/${boardId}/labels/${labelId}`, await getToken()),
      // Off the vocabulary and off every card carrying it. The server cascades
      // the join rows but broadcasts one operation, so the client has to do
      // both halves or the label lingers on cards until a reload.
      (current) => ({
        ...current,
        labels: current.labels.filter((l) => l.id !== labelId),
        columns: current.columns.map((col) => ({
          ...col,
          cards: col.cards.map((c) => ({
            ...c,
            labels: c.labels.filter((l) => l.id !== labelId),
          })),
        })),
      }),
      "rethrow"
    );
  }

  async function handleDeleteCard(cardId: string) {
    closeCard();
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

  /**
   * A card dropped into a cell of the lanes matrix.
   *
   * Sideways moves say nothing and just go, exactly as they do on the column
   * board. A move that changes rows asks first: reassigning somebody's work, or
   * re-prioritising it, by dragging slightly too far is not something to do
   * silently (S4.2).
   */
  async function handleLaneDrop(cardId: string, cell: { laneId: string; columnId: string }) {
    if (!board || !canEdit) return;

    const source = board.columns.find((col) => col.cards.some((c) => c.id === cardId));
    const card = source?.cards.find((c) => c.id === cardId);
    if (!card) return;

    const lanes = lanesFor(visibleBoard ?? board, laneView, memberNames);
    const from = lanes.find((l) => l.cells.some((cards) => cards.some((c) => c.id === cardId)));
    const to = lanes.find((l) => l.id === cell.laneId);
    // Deliberately not gated on `to.acceptsLaneChange` here. A drop into a lane
    // that refuses one may still be a stage change within the card's own row,
    // which every lane allows; `resolveLaneDrop` is the single place that tells
    // the two apart, and duplicating half its rule here is what stopped the
    // label view moving cards between columns at all.
    if (!from || !to) return;

    const drop = resolveLaneDrop({
      card,
      fromLaneId: from.id,
      toLaneId: to.id,
      toColumnId: cell.columnId,
      view: laneView,
      laneName: to.name,
    });
    if (!drop) return;

    if (drop.confirm) {
      const ok = await confirm({
        title: drop.confirm.title,
        body: drop.confirm.body,
        confirmLabel: drop.confirm.confirmLabel,
      });
      if (!ok) return;
    }

    const snapshot = board;
    try {
      const token = await getToken();
      // Stage first, then the field. If the move fails the card has not been
      // reassigned yet, which is the better half-done state of the two.
      if (drop.targetColumnId) {
        await api.post(`/boards/${boardId}/cards/${cardId}/move`, token, {
          targetColumnId: drop.targetColumnId,
          beforeCardId: null,
        });
      }
      if (drop.update) {
        await api.patch(`/boards/${boardId}/cards/${cardId}`, token, drop.update);
      }
    } catch (err) {
      setBoard(snapshot);
      const { message, canRetry } = friendlyError(err, "move that card");
      setActionError({
        message,
        retry: canRetry ? () => void handleLaneDrop(cardId, cell) : undefined,
      });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over || !board || active.id === over.id) return;
    // Backstop: individual cards already refuse to start a drag for viewers,
    // but this keeps the optimistic update from ever running for one.
    if (!canEdit) return;

    // A drop onto a lane cell is a different kind of event from a drop onto a
    // column: it can change the card's stage *and* who holds it, and the second
    // half is a mutation rather than a reorder. Handled first, and separately.
    const cell = parseCellId(String(over.id));
    if (cell) {
      await handleLaneDrop(String(active.id), cell);
      return;
    }

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

      {/* Not a 52px chrome bar (v7). The board announces itself: a breadcrumb
          that says where you are and what you are, then the name at display
          size. The controls sit on the title's baseline rather than in a strip
          above it, so the first thing on screen is the board rather than the
          furniture around it. */}
      <header className="shrink-0 px-[30px] pt-[22px]">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-text-dim">
              <Link href="/boards" className="hover:text-text transition-colors">
                Boards
              </Link>
              <span aria-hidden="true">/</span>
              {/* The caller's own role, which is the thing a viewer most needs
                  to know and previously only appeared as a pill once something
                  was already missing. */}
              <span className="text-accent">{board.role}</span>
            </div>

            <div className="flex items-center gap-2 mt-[7px]">
              <h1
                className="text-[32px] font-normal tracking-[-0.013em] truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {board.name}
              </h1>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Board settings"
                  title="Board settings"
                  className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-text-dim hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="7" r="1.3" />
                    <circle cx="7" cy="7" r="1.3" />
                    <circle cx="11" cy="7" r="1.3" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3.5 shrink-0 pb-1.5">
            <div className="flex items-center gap-1.5" data-tour="sync">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: connected ? "var(--success)" : "var(--warn)" }}
              />
              {/* The dot is the signal; the word is its caption. `--warn` as text
                  measured 1.84–3.72:1 across the light palettes, and the colour
                  carried nothing the dot was not already carrying in a shape
                  nobody has to read. */}
              <span className="text-[11px] text-text-muted whitespace-nowrap">
                {connected ? "Synced" : "Connecting…"}
              </span>
            </div>

            {/* Names the reason the editing controls are missing. Without it a
                viewer just sees a board that appears to lack features. */}
            {!canEdit && (
              <span
                title="You have view-only access to this workspace. Ask an owner for Editor access to make changes."
                className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-[10px] uppercase tracking-[0.08em] text-text-muted whitespace-nowrap"
              >
                View only
              </span>
            )}

            <PresenceAvatars users={presentUsers} />

            <Link
              href={`/workspace/${board.workspaceId}/members`}
              className="px-3.5 py-2 border border-border rounded-md text-[12.5px] text-text-muted hover:text-text hover:border-text-dim transition-colors"
            >
              Share
            </Link>

            {canEdit && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={!connected || board.columns.length === 0}
                data-tour="create"
                title="Create a card (c)"
                className="px-[15px] py-2 rounded-md bg-accent text-accent-fg text-[12.5px] font-medium hover:bg-accent-h transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                New card
              </button>
            )}

            <UserMenu onShowMeAround={() => setTourOpen(true)} />
          </div>
        </div>
      </header>

      {/* Below the header rather than inside it: the header identifies the
          board and never changes, while this changes what you are looking at.
          Hidden until there is something to filter — a search box over an empty
          board is furniture. */}
      {board.columns.length > 0 && (
        <BoardFilterBar
          filter={filter}
          members={members}
          labels={board.labels}
          currentUserId={user?.uid ?? null}
          matches={visibleBoard ? countMatches(visibleBoard) : 0}
          total={countMatches(board)}
          onChange={setFilter}
          onClear={clearFilter}
          view={laneView}
          onViewChange={setLaneView}
        />
      )}

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
          // The two views want opposite things from this box. Columns scroll
          // sideways while each column scrolls its own cards, so the board must
          // not scroll vertically. The matrix is one tall grid that scrolls
          // down, and its rows must not be clipped.
          //
          // It also has to be a flex column for lanes: BoardLanes is
          // `flex-1 min-h-0`, which resolves against nothing in a plain block
          // and leaves the inner scroll area as tall as its content — the whole
          // reason lanes would not scroll at all.
          className={
            laneView === "status"
              ? "flex-1 overflow-x-auto overflow-y-hidden px-6 py-5 relative"
              : "flex-1 min-h-0 flex flex-col overflow-hidden relative"
          }
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
          {board.columns.length === 0 && !pendingColumn ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm font-medium">This board is empty.</p>
              <p className="text-[13px] text-text-muted max-w-xs">
                {canEdit
                  ? "Columns are the stages work moves through. Start from a shape, or name your own."
                  : "Nobody has added any columns yet. You'll see them here as soon as someone does."}
              </p>
              {canEdit && (
                <Button size="sm" onClick={() => setSeedingColumns(true)} disabled={!connected}>
                  Add columns
                </Button>
              )}
            </div>
          ) : (
          laneView !== "status" ? (
            // The matrix. Given the *filtered* board, so a filter narrows what
            // the lanes contain rather than which lanes exist -- an empty row
            // under a filter is information, and dropping it would hide it.
            <BoardLanes
              board={visibleBoard ?? board}
              view={laneView}
              memberNames={memberNames}
              onCardClick={(card) => openCardById(card.id)}
              canEdit={canEdit}
              currentUserId={currentUserId}
              memberRoles={memberRoles}
            />
          ) : (
          <div className="flex items-stretch gap-3 h-full" data-tour="columns">
            {(visibleBoard ?? board).columns.map((column, i) => (
              <BoardColumn
                key={column.id}
                column={column}
                totalCards={board.columns[i]?.cards.length ?? column.cards.length}
                filtering={filtering}
                colorIndex={i}
                disabled={!connected}
                canEdit={canEdit}
                startAdding={autoAddFirstCard && i === 0}
                tourAnchors={i === 0}
                memberNames={memberNames}
                onAddCard={handleAddCard}
                onRenameColumn={handleRenameColumn}
                onSetLimits={handleSetColumnLimits}
                onDeleteColumn={handleDeleteColumn}
                onCardClick={(card) => openCardById(card.id)}
              />
            ))}

            {/* Same reasoning as the pending card: the server assigns the rank,
                so this says "on its way" rather than faking the row. */}
            {pendingColumn && (
              <div className="flex-1 basis-0 min-w-[240px] flex items-center gap-2 px-0.5 opacity-60">
                <span className="w-2 h-2 rounded-full bg-border-2 shrink-0" />
                <span className="text-[11px] font-semibold tracking-wider uppercase text-text-dim truncate">
                  {pendingColumn}
                </span>
                <span className="text-[11px] text-text-dim">Adding…</span>
              </div>
            )}

          </div>
          )
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

      {settingsOpen && (
        <BoardSettingsDialog
          columns={board.columns}
          connected={connected}
          onRename={handleRenameColumn}
          onMove={handleMoveColumn}
          onSetLimits={handleSetColumnLimits}
          onDelete={handleDeleteColumn}
          onAdd={handleAddColumn}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {seedingColumns && (
        <SeedColumnsDialog
          onCreate={handleSeedColumns}
          onClose={() => setSeedingColumns(false)}
        />
      )}

      {creating && board.columns.length > 0 && (
        <CreateCardDialog
          statuses={board.columns.map((c) => ({ id: c.id, name: c.name }))}
          members={members}
          labels={board.labels}
          // The first column, because that is where work starts. Jira's inline
          // create puts a card in the column you clicked; there is no such
          // column here, so the board's own order decides.
          defaultColumnId={board.columns[0].id}
          filter={filter}
          filterActive={filtering}
          onCreate={handleCreateCard}
          onClearFilter={clearFilter}
          onClose={() => setCreating(false)}
        />
      )}

      {openCardValue && (
        <CardDetailModal
          card={openCardValue}
          readOnly={!canEdit}
          members={members}
          statuses={board.columns.map((c) => ({ id: c.id, name: c.name }))}
          labels={board.labels}
          onClose={closeCard}
          onStepPrev={prevCardId ? () => openCardById(prevCardId) : undefined}
          onStepNext={nextCardId ? () => openCardById(nextCardId) : undefined}
          onCommit={(update) => handleUpdateCard(openCardValue.id, update)}
          onMove={(targetColumnId) => handleSetCardColumn(openCardValue.id, targetColumnId)}
          onDelete={() => handleDeleteCard(openCardValue.id)}
          onCreateLabel={handleCreateLabel}
          onDeleteLabel={handleDeleteLabel}
          comments={{
            // Only when it is this card's. A thread left over from the
            // previously opened card renders as empty rather than as someone
            // else's conversation.
            items: thread?.cardId === openCardId ? thread.items : [],
            loading: commentsLoading,
            error: commentsError,
            currentUserId: currentUserId,
            onAdd: handleAddComment,
            onEdit: handleEditComment,
            onDelete: handleDeleteComment,
            onRetry: () => setCommentsReload((n) => n + 1),
          }}
        />
      )}

      {tourOpen && <Walkthrough steps={BOARD_TOUR} onFinish={() => setTourOpen(false)} />}

      {dialog}
    </div>
  );
}
