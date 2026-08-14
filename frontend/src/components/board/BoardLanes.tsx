"use client";

import type { BoardDetailResponse, CardResponse } from "@/lib/api";
import { KanbanCard } from "@/components/board/KanbanCard";
import { identityColor } from "@/lib/identityColors";
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
 * Read-only for now, deliberately. Dragging here means two things at once —
 * sideways changes the stage, downwards changes the assignee or the priority —
 * and the second is a mutation a drag should not perform until the semantics
 * are settled. Cards still open, which is most of what this view is for.
 */
export function BoardLanes({
  board,
  view,
  memberNames,
  onCardClick,
}: {
  board: BoardDetailResponse;
  view: LaneView;
  memberNames: Map<string, string>;
  onCardClick: (card: CardResponse) => void;
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
          lanes.map((lane) => (
            <div
              key={lane.id}
              className="grid border-b border-border-2 min-h-[104px]"
              style={{ gridTemplateColumns: template }}
            >
              <div className="py-[18px] pr-[18px] flex gap-3 items-start">
                <span
                  aria-hidden="true"
                  className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.02em] leading-none text-accent-fg"
                  style={{ background: identityColor(lane.id) }}
                >
                  {initialsFor(lane.name)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium tracking-[-0.008em] truncate">
                    {lane.name}
                  </span>
                  <span className="block mt-1 text-[11px] text-text-dim tabular-nums">
                    {lane.count === 1 ? "1 card" : `${lane.count} cards`}
                  </span>
                </span>
              </div>

              {lane.cells.map((cards, i) => (
                <div
                  key={board.columns[i].id}
                  className="px-3.5 py-3 border-l border-border-2 flex flex-col gap-2"
                >
                  {cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => onCardClick(card)}
                      className="block w-full text-left cursor-pointer"
                    >
                      <KanbanCard
                        card={card}
                        assigneeName={
                          card.assigneeId ? memberNames.get(card.assigneeId) : undefined
                        }
                      />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Two letters at most, so a long name and a short one occupy the same square. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
