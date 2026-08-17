"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";
import { cellId } from "@/lib/laneDrop";
import { KanbanCard } from "@/components/board/KanbanCard";
import { identityColor } from "@/lib/identityColors";
import { labelSwatchStyle } from "@/lib/labelColors";
import { initialsOf } from "@/lib/initials";
import { LANE_VIEWS, lanesFor, visibleLanes, type LaneView } from "@/lib/boardLanes";
import { limitState } from "@/lib/columnLimit";

/**
 * The board as a matrix: rows are lanes, columns are still the stages.
 *
 * Every card sits at the crossing of who holds it and where it stands, which is
 * the whole claim the v7 direction makes — and it is a genuinely different
 * question from the column board. A column answers "what is in review"; a lane
 * answers "what is Rita carrying, and how far along is any of it".
 *
 * Dragging means two things at once, and the axes are governed separately.
 * Sideways changes the stage and is always allowed — it is the ordinary kanban
 * action and it means the same thing however the rows are grouped. Downwards
 * changes who holds the card or how urgent it is, which is a field mutation
 * arrived at by gesture, so it confirms first and some rows refuse it outright.
 */
export function BoardLanes({
  board,
  view,
  memberNames,
  onCardClick,
  canEdit,
  currentUserId,
  memberRoles,
}: {
  board: BoardDetailResponse;
  view: LaneView;
  memberNames: Map<string, string>;
  onCardClick: (card: CardResponse) => void;
  /** Viewers get the matrix without the drag handles (S8.1: removed, not disabled). */
  canEdit: boolean;
  /** Ours, so the person view can say which row is yours. */
  currentUserId?: string | null;
  /** User id to workspace role, for the badge on a person lane. */
  memberRoles?: Map<string, string>;
}) {
  const lanes = visibleLanes(lanesFor(board, view, memberNames), view);
  const laneLabel = LANE_VIEWS.find((v) => v.id === view)?.laneLabel ?? "";

  // One grid template for the header and every row, so the columns line up
  // without either knowing about the other.
  const template = `186px repeat(${board.columns.length}, minmax(0, 1fr))`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Column heads. The rule under them is --text rather than --border: it
          separates the board's axis from its contents, and a hairline there
          reads as just another row divider. */}
      <div
        className="shrink-0 grid px-[30px] border-b border-text"
        style={{ gridTemplateColumns: template }}
      >
        <div className="pb-2.5 text-[10px] uppercase tracking-[0.12em] text-text-dim">
          {laneLabel}
        </div>
        {board.columns.map((column, i) => {
          const state = limitState(column.cards.length, column);
          const max = column.maxCards ?? 0;
          const pct = max > 0 ? Math.min(100, (column.cards.length / max) * 100) : 0;
          return (
            <div key={column.id} className="px-4 pb-2.5">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-[19px] font-semibold leading-none text-text-dim tabular-nums"
                  style={{ fontFamily: "var(--font-display)" }}
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted truncate">
                  {column.name}
                </span>
                {state === "over" && (
                  <span className="px-1.5 py-px rounded-md bg-danger-soft text-danger text-[9.5px] uppercase tracking-[0.06em] font-semibold">
                    Over
                  </span>
                )}
                {state === "under" && (
                  <span className="px-1.5 py-px rounded-md bg-warn-soft text-warn text-[9.5px] uppercase tracking-[0.06em] font-semibold">
                    Under
                  </span>
                )}
              </div>
              {/* Only drawn where a maximum exists. A bar with no ceiling is a
                  bar measuring nothing. */}
              {max > 0 && (
                <div className="mt-2 h-[3px] rounded-md bg-border-2 overflow-hidden">
                  <div
                    className="h-full"
                    style={{
                      width: `${pct}%`,
                      background: state === "over" ? "var(--danger)" : "var(--accent)",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[30px] pb-10">
        {lanes.length === 0 ? (
          <p className="pt-8 text-[13px] text-text-muted">
            Nothing to group yet. Cards will appear here once there are some.
          </p>
        ) : (
          lanes.map((lane) => {
            const mine = currentUserId ? lane.id === `lane:person:${currentUserId}` : false;
            const labelId = lane.id.startsWith("lane:label:")
              ? lane.id.slice("lane:label:".length)
              : null;
            const labelColor = labelId
              ? board.labels.find((l) => l.id === labelId)?.color ?? null
              : null;
            const role = memberRoles?.get(lane.id.slice("lane:person:".length));

            return (
              <div
                key={lane.id}
                // Your own row is tinted. On a grid of otherwise identical rows
                // the one question you ask first is "which of these is me", and
                // a tint answers it without adding a word.
                //
                // `surface-2`, not `surface`: the cards are `surface`, so
                // tinting the row with the same token took the ground out from
                // under them and they lost their edge on exactly the row you
                // look at most. This pair is the one `globals.contrast.test.ts`
                // already holds 4 L* apart, so the cards keep their separation
                // by the same guarantee everything else on the board uses.
                //
                // The separator is `--border` rather than the `--border-2`
                // hairline used inside a row: at this row height a hairline did
                // not survive the distance between one lane and the next.
                className={`grid border-b border-border min-h-[104px] ${
                  mine ? "bg-surface-2" : ""
                }`}
                style={{ gridTemplateColumns: template }}
              >
                <div className="py-[18px] pr-[18px] flex gap-3 items-start">
                  {/* Square and in the label's own colour for a label lane,
                      round and identity-coloured for a person. The shape says
                      which kind of thing the row groups by before the name is
                      read — and it is the label's hue here rather than a hue
                      derived from its id, so the row matches the dot the cards
                      inside it carry. */}
                  <span
                    aria-hidden="true"
                    className={`shrink-0 w-7 h-7 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.02em] leading-none text-accent-fg ${
                      labelColor ? "rounded-[2px]" : "rounded-full"
                    }`}
                    style={
                      labelColor ? labelSwatchStyle(labelColor) : { background: identityColor(lane.id) }
                    }
                  >
                    {initialsOf(lane.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium tracking-[-0.008em] truncate">
                      {lane.name}
                    </span>
                    <span className="flex items-center gap-[7px] mt-1 text-[11px] text-text-dim">
                      <span className="tabular-nums">
                        {lane.count === 1 ? "1 card" : `${lane.count} cards`}
                      </span>
                      {role && (
                        <span className="px-1.5 py-px rounded-[2px] bg-surface-2 text-[9.5px] uppercase tracking-[0.06em]">
                          {role}
                        </span>
                      )}
                    </span>
                  </span>
                </div>

                {lane.cells.map((cards, i) => (
                  <LaneCell
                    key={board.columns[i].id}
                    id={cellId(lane.id, board.columns[i].id)}
                    laneId={lane.id}
                    acceptsLaneChange={lane.acceptsLaneChange}
                    canEdit={canEdit}
                  >
                    {cards.map((card) => (
                      <LaneCard
                        key={card.id}
                        card={card}
                        laneId={lane.id}
                        draggable={canEdit}
                        assigneeName={
                          card.assigneeId ? memberNames.get(card.assigneeId) : undefined
                        }
                        onClick={() => onCardClick(card)}
                      />
                    ))}
                  </LaneCell>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * One crossing of a lane and a column.
 *
 * Takes a drop in two cases, and they are not the same case. A card already in
 * this row is only changing stage, which is unambiguous however the board is
 * grouped — so even label rows accept it. A card arriving from another row is
 * also changing a field, which only rows representing one single-valued thing
 * can absorb.
 *
 * The cell registers as a drop target either way rather than toggling
 * `disabled` on the active drag: dnd-kit measures droppable rects when the drag
 * starts, so one that switches on afterwards has no rect to collide with. What
 * changes is the highlight, which is withheld unless the drop would actually do
 * something — an invalid cell that lit up would promise a move it then refuses.
 */
function LaneCell({
  id,
  laneId,
  acceptsLaneChange,
  canEdit,
  children,
}: {
  id: string;
  laneId: string;
  acceptsLaneChange: boolean;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canEdit });

  return (
    <div
      ref={setNodeRef}
      data-lane={laneId}
      data-accepts-lane-change={acceptsLaneChange ? "" : undefined}
      className={`px-3.5 py-3 border-l border-border-2 flex flex-col gap-2 transition-colors ${
        isOver ? "bg-accent-soft" : ""
      }`}
    >
      {children}
    </div>
  );
}

/**
 * A card in the matrix.
 *
 * The whole card is the drag handle *and* the button that opens it, which works
 * because dnd-kit only starts a drag past an 8px threshold — a click stays a
 * click. Keyboard users get the same split the column board uses: Enter opens,
 * Space picks up.
 */
function LaneCard({
  card,
  laneId,
  draggable,
  assigneeName,
  onClick,
}: {
  card: CardResponse;
  laneId: string;
  draggable: boolean;
  assigneeName?: string;
  onClick: () => void;
}) {
  // Keyed by lane as well as card: a multi-label card appears in several rows,
  // and two draggables sharing an id would make dnd-kit pick up whichever it
  // saw last regardless of which one was grabbed.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
    data: { laneId },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={`block w-full text-left cursor-pointer ${isDragging ? "opacity-40" : ""}`}
      // Spread only when the card can actually be dragged. dnd-kit returns its
      // attributes regardless of `disabled`, so spreading unconditionally left a
      // viewer's card announcing itself as "draggable" to a screen reader and
      // then refusing to move — the disabled affordance S8.1 exists to prevent,
      // visible only to the people who cannot see it is inert.
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
    >
      <KanbanCard card={card} assigneeName={assigneeName} />
    </button>
  );
}
