import type { CardResponse, UpdateCardRequest } from "@/lib/api";
import type { LaneView } from "@/lib/boardLanes";

/**
 * What dropping a card into a cell of the matrix means.
 *
 * Two axes, two different kinds of change, and the difference is the whole
 * reason this is a module rather than a branch inside a drag handler:
 *
 * - **Sideways** moves the card between stages. That is the ordinary kanban
 *   action, it is what the column board has always done, and it asks nothing.
 * - **Downwards** changes who holds the card, or how urgent it is. That is a
 *   mutation of the card's own fields, arrived at by dragging rather than by
 *   opening it and choosing — so it confirms first (S4.2). Reassigning
 *   somebody's work by a slightly long mouse gesture is exactly the kind of
 *   thing that should not happen silently.
 *
 * Both can happen in one drop, and then both apply and the confirmation names
 * the reassignment, which is the surprising half.
 */
export type LaneDrop = {
  /** Set when the card changed column. Null when it stayed in its stage. */
  targetColumnId: string | null;
  /** Set when the card changed lane. Null when it stayed in its row. */
  update: UpdateCardRequest | null;
  /** Present exactly when `update` is — the sentence shown before applying. */
  confirm: { title: string; body: string; confirmLabel: string } | null;
};

/** `cell:{laneId}:{columnId}` — parsed rather than passed around as three props. */
export function cellId(laneId: string, columnId: string): string {
  return `cell:${laneId}:${columnId}`;
}

export function parseCellId(id: string): { laneId: string; columnId: string } | null {
  if (!id.startsWith("cell:")) return null;
  const rest = id.slice("cell:".length);
  // The lane id itself contains colons (`lane:person:{uuid}`), so split from the
  // right: the column id is the last segment and never contains one.
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  return { laneId: rest.slice(0, cut), columnId: rest.slice(cut + 1) };
}

/**
 * Works out the drop, or returns null when nothing would change.
 *
 * Returning null for a no-op matters: dropping a card back where it started is
 * the most common way a drag ends, and it must not raise a confirmation asking
 * whether to assign somebody the work they already have.
 */
export function resolveLaneDrop({
  card,
  fromLaneId,
  toLaneId,
  toColumnId,
  view,
  laneName,
}: {
  card: CardResponse;
  fromLaneId: string;
  toLaneId: string;
  toColumnId: string;
  view: LaneView;
  /** The destination lane's display name, for the confirmation sentence. */
  laneName: string;
}): LaneDrop | null {
  const columnChanged = card.columnId !== toColumnId;
  const laneChanged = fromLaneId !== toLaneId;

  if (!columnChanged && !laneChanged) return null;

  if (!laneChanged) {
    return { targetColumnId: toColumnId, update: null, confirm: null };
  }

  const update = updateForLane(toLaneId, view);
  if (!update) return null;

  const quoted = card.title.trim() || "this card";

  return {
    targetColumnId: columnChanged ? toColumnId : null,
    update,
    confirm:
      view === "person"
        ? {
            title: toLaneId === "lane:unassigned" ? "Unassign this card?" : "Reassign this card?",
            body:
              toLaneId === "lane:unassigned"
                ? `“${quoted}” will no longer be assigned to anyone.`
                : `“${quoted}” will be assigned to ${laneName}.`,
            confirmLabel: toLaneId === "lane:unassigned" ? "Unassign" : "Reassign",
          }
        : {
            title: "Change this card's priority?",
            body:
              toLaneId === "lane:no-priority"
                ? `“${quoted}” will have no priority.`
                : `“${quoted}” will be set to ${laneName} priority.`,
            confirmLabel: "Change priority",
          },
  };
}

/**
 * The field change a lane implies.
 *
 * Label lanes return null and are never droppable — a card can carry several
 * labels, so "put this card in `bug`" would also have to decide what happens to
 * the ones it already has, and silently replacing them is a destructive guess.
 */
function updateForLane(laneId: string, view: LaneView): UpdateCardRequest | null {
  if (view === "person") {
    if (laneId === "lane:unassigned") return { clearAssignee: true };
    if (laneId.startsWith("lane:person:")) {
      return { assigneeId: laneId.slice("lane:person:".length) };
    }
    return null;
  }

  if (view === "priority") {
    if (laneId === "lane:no-priority") return { clearPriority: true };
    if (laneId.startsWith("lane:priority:")) {
      return { priority: laneId.slice("lane:priority:".length) as UpdateCardRequest["priority"] };
    }
    return null;
  }

  return null;
}
