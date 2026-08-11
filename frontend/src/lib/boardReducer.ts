import type {
  BoardDetailResponse,
  CardResponse,
  ColumnResponse,
  LabelResponse,
} from "@/lib/api";

function byRank<T extends { rank: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
}

function upsertCard(board: BoardDetailResponse, card: CardResponse): BoardDetailResponse {
  return {
    ...board,
    columns: board.columns.map((col) => {
      const withoutCard = col.cards.filter((c) => c.id !== card.id);
      return col.id === card.columnId
        ? { ...col, cards: byRank([...withoutCard, card]) }
        : { ...col, cards: withoutCard };
    }),
  };
}

function removeCard(board: BoardDetailResponse, cardId: string, columnId: string): BoardDetailResponse {
  return {
    ...board,
    columns: board.columns.map((col) =>
      col.id === columnId ? { ...col, cards: col.cards.filter((c) => c.id !== cardId) } : col
    ),
  };
}

function upsertColumn(board: BoardDetailResponse, column: ColumnResponse): BoardDetailResponse {
  const existing = board.columns.find((c) => c.id === column.id);
  const merged = { ...column, cards: existing?.cards ?? [] };
  const withoutColumn = board.columns.filter((c) => c.id !== column.id);
  return { ...board, columns: byRank([...withoutColumn, merged]) };
}

function removeColumn(board: BoardDetailResponse, columnId: string): BoardDetailResponse {
  return { ...board, columns: board.columns.filter((c) => c.id !== columnId) };
}

// Places the dragged card at the exact drop position immediately (before
// the server confirms), rather than waiting on the rank-sorted reducer
// below -- the authoritative broadcast that follows moments later
// reconciles it to the server-computed rank via applyOperation.
export function moveCardOptimistic(
  board: BoardDetailResponse,
  cardId: string,
  targetColumnId: string,
  beforeCardId: string | null
): BoardDetailResponse {
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
  if (!card) return board;

  const withoutCard = board.columns.map((col) => ({
    ...col,
    cards: col.cards.filter((c) => c.id !== cardId),
  }));

  return {
    ...board,
    columns: withoutCard.map((col) => {
      if (col.id !== targetColumnId) return col;
      const insertAt = beforeCardId ? col.cards.findIndex((c) => c.id === beforeCardId) : -1;
      const next = [...col.cards];
      next.splice(insertAt === -1 ? next.length : insertAt, 0, { ...card, columnId: targetColumnId });
      return { ...col, cards: next };
    }),
  };
}

// Applies one broadcast operation to board state. Used both to reconcile a
// move this tab initiated optimistically, and to apply moves/renames/deletes
// that arrived from someone else -- each case is idempotent (re-applying the
// same operation twice is harmless) since every op replaces state by id
// rather than appending blindly.
export function applyOperation(
  board: BoardDetailResponse,
  opType: string,
  payload: unknown
): BoardDetailResponse {
  switch (opType) {
    case "card.create":
    case "card.rename":
    case "card.move":
      return upsertCard(board, payload as CardResponse);
    case "card.delete": {
      const { id, columnId } = payload as { id: string; columnId: string };
      return removeCard(board, id, columnId);
    }
    case "column.create":
    case "column.rename":
    case "column.move":
      return upsertColumn(board, payload as ColumnResponse);
    case "column.delete": {
      const { id } = payload as { id: string };
      return removeColumn(board, id);
    }
    // The board's label vocabulary. Which labels a *card* carries arrives on
    // the card operations above, because that is a field of the card -- there
    // is deliberately no card.label.add.
    case "label.create":
    case "label.update":
      return upsertLabel(board, payload as LabelResponse);
    case "label.delete": {
      const { id } = payload as { id: string };
      return removeLabel(board, id);
    }
    // Only the *count* on the card is board state. The thread itself lives with
    // whoever has the card open, because it is unbounded and most cards on the
    // board are not being read.
    case "comment.create":
      return shiftCommentCount(board, (payload as { cardId: string }).cardId, 1);
    case "comment.delete":
      return shiftCommentCount(board, (payload as { cardId: string }).cardId, -1);
    case "comment.edit":
      // Nothing on the board changes: the body is inside the thread, and the
      // count is the same. Named anyway so it is clear this was considered
      // rather than forgotten.
      return board;
    default:
      return board;
  }
}

/** Replaces by id so a create and an update share one path, and both are idempotent. */
function upsertLabel(board: BoardDetailResponse, label: LabelResponse): BoardDetailResponse {
  const existing = board.labels.some((l) => l.id === label.id);
  const labels = existing
    ? board.labels.map((l) => (l.id === label.id ? label : l))
    : [...board.labels, label];

  return {
    ...board,
    labels: labels.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Removes the label, and strips it from every card carrying it.
 *
 * The server cascades the join rows but broadcasts only `label.delete` — one
 * operation for one action. Without this the label would vanish from the picker
 * and stay on the cards until a reload, which reads as the delete half-working.
 */
function removeLabel(board: BoardDetailResponse, labelId: string): BoardDetailResponse {
  return {
    ...board,
    labels: board.labels.filter((l) => l.id !== labelId),
    columns: board.columns.map((col) => ({
      ...col,
      cards: col.cards.map((c) =>
        c.labels.some((l) => l.id === labelId)
          ? { ...c, labels: c.labels.filter((l) => l.id !== labelId) }
          : c
      ),
    })),
  };
}

/**
 * Nudges a card's comment badge.
 *
 * A delta rather than a value, because the broadcast carries the comment, not a
 * recount — and asking the server for one on every comment would be a request
 * per keystroke's worth of conversation. Clamped at zero so a delete that
 * arrives twice cannot push the badge negative.
 */
function shiftCommentCount(
  board: BoardDetailResponse,
  cardId: string,
  delta: number
): BoardDetailResponse {
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      cards: col.cards.map((c) =>
        c.id === cardId ? { ...c, commentCount: Math.max(0, c.commentCount + delta) } : c
      ),
    })),
  };
}
