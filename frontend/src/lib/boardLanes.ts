import type { BoardDetailResponse, CardPriority, CardResponse, LabelResponse } from "@/lib/api";
import { PRIORITIES } from "@/lib/priority";

/**
 * How the board is grouped into rows.
 *
 * `status` is the board Tangram has always had: one column per stage, cards
 * stacked inside. The other three are the v7 matrix — rows are lanes, columns
 * are still the stages, and every card sits at the crossing of who holds it and
 * where it stands.
 */
export type LaneView = "status" | "person" | "priority" | "label";

export const LANE_VIEWS: { id: LaneView; name: string; laneLabel: string }[] = [
  { id: "status", name: "Columns", laneLabel: "" },
  { id: "person", name: "By person", laneLabel: "Person" },
  { id: "priority", name: "By priority", laneLabel: "Priority" },
  { id: "label", name: "By label", laneLabel: "Label" },
];

export type Lane = {
  /** Stable across renders; also the drop target id when a lane is droppable. */
  id: string;
  name: string;
  /** Cards per column, in the board's column order. */
  cells: CardResponse[][];
  /** Total across the row, which is what the lane header counts. */
  count: number;
  /**
   * Whether dropping a card into this lane means anything.
   *
   * True for person and priority, which are single-valued: moving a card into
   * the lane sets that one field. False for labels, where a card can carry
   * several — "make this card belong to `bug`" is unambiguous, but the drop
   * would also have to decide what happens to the labels it already has, and
   * silently replacing them is the kind of destructive guess a drag should
   * never make.
   */
  droppable: boolean;
};

const UNASSIGNED = "lane:unassigned";
const NO_PRIORITY = "lane:no-priority";
const NO_LABEL = "lane:no-label";

/**
 * Groups a board into lanes.
 *
 * Pure, and given the *already filtered* board — filtering and grouping are
 * separate questions, and doing them in one pass would mean a lane's count
 * silently meant something different when a filter was on.
 */
export function lanesFor(
  board: BoardDetailResponse,
  view: LaneView,
  memberNames: Map<string, string>
): Lane[] {
  if (view === "status") return [];

  const columns = board.columns;
  const emptyCells = () => columns.map(() => [] as CardResponse[]);

  // Insertion-ordered, so lanes appear in the order the grouping defines rather
  // than the order cards happen to be in.
  const lanes = new Map<string, Lane>();
  const lane = (id: string, name: string, droppable: boolean) => {
    let existing = lanes.get(id);
    if (!existing) {
      existing = { id, name, cells: emptyCells(), count: 0, droppable };
      lanes.set(id, existing);
    }
    return existing;
  };

  if (view === "person") {
    // Every member gets a lane, not just those holding work. An empty row is
    // the useful part of this view: it says who is free.
    for (const [id, name] of memberNames) lane(`lane:person:${id}`, name, true);
    lane(UNASSIGNED, "Unassigned", true);
  } else if (view === "priority") {
    for (const p of PRIORITIES) lane(`lane:priority:${p}`, p, true);
    lane(NO_PRIORITY, "No priority", true);
  } else {
    for (const l of board.labels) lane(`lane:label:${l.id}`, l.name, false);
    lane(NO_LABEL, "Unlabelled", false);
  }

  columns.forEach((column, columnIndex) => {
    for (const card of column.cards) {
      for (const target of lanesForCard(card, view, board.labels)) {
        const row = lane(target.id, target.name, target.droppable);
        row.cells[columnIndex].push(card);
        row.count++;
      }
    }
  });

  return [...lanes.values()];
}

/**
 * Which lanes a card belongs to.
 *
 * One for person and priority. For labels it is one *per label*, which is the
 * decision worth naming: a card carrying `bug` and `urgent` appears in both
 * rows. Choosing its first label instead would make the board lie about where
 * the work is, and showing it in neither would hide it. The cost is that a card
 * can be on screen twice, which is why the label view does not accept drops.
 */
function lanesForCard(
  card: CardResponse,
  view: LaneView,
  labels: LabelResponse[]
): { id: string; name: string; droppable: boolean }[] {
  if (view === "person") {
    return [
      card.assigneeId
        ? { id: `lane:person:${card.assigneeId}`, name: "", droppable: true }
        : { id: UNASSIGNED, name: "Unassigned", droppable: true },
    ];
  }

  if (view === "priority") {
    const priority = PRIORITIES.find((p) => p === (card.priority as CardPriority));
    return [
      priority
        ? { id: `lane:priority:${priority}`, name: priority, droppable: true }
        : { id: NO_PRIORITY, name: "No priority", droppable: true },
    ];
  }

  if (card.labels.length === 0) {
    return [{ id: NO_LABEL, name: "Unlabelled", droppable: false }];
  }

  return card.labels.map((l) => ({
    id: `lane:label:${l.id}`,
    name: labels.find((x) => x.id === l.id)?.name ?? l.name,
    droppable: false,
  }));
}

/**
 * Lanes with nothing in them, dropped — except in the person view.
 *
 * A board grouped by priority does not need a row for every level nobody used;
 * a board grouped by person does, because "who has no work" is exactly the
 * question that view answers.
 */
export function visibleLanes(lanes: Lane[], view: LaneView): Lane[] {
  if (view === "person") return lanes;
  return lanes.filter((l) => l.count > 0);
}
