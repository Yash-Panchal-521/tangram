"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { limitLabel, limitState } from "@/lib/columnLimit";
import { useDialog } from "@/lib/useDialog";
import type { ColumnWithCardsResponse, SetColumnLimitsRequest } from "@/lib/api";

/**
 * Everything about a board's columns, in one place.
 *
 * Jira puts column management behind **Board settings** rather than on the
 * board, and this follows that — but for a different reason. Jira buries it
 * because a column there is bound to workflow statuses, so adding one has
 * consequences elsewhere; a column here is just a column. What earns the panel
 * is the *managing*, not the adding:
 *
 * - **Reordering had no UI at all.** `POST /columns/{id}/move` and the
 *   `column.move` broadcast have both shipped since v1 with nothing calling
 *   them. The order of a board's stages was fixed at creation.
 * - **Limits were only visible one column at a time**, inside each column's
 *   `⋯`. A work-in-progress limit is a statement about flow through the whole
 *   board, and you cannot judge one without seeing the rest.
 *
 * Up and down rather than dragging. A dialog full of drag targets is awkward to
 * operate by keyboard, and the API takes a `beforeColumnId` — which is exactly
 * what "swap with your neighbour" means, with no coordinates in between.
 */
export function BoardSettingsDialog({
  columns,
  connected,
  onRename,
  onMove,
  onSetLimits,
  onDelete,
  onAdd,
  onClose,
}: {
  columns: ColumnWithCardsResponse[];
  /** Controls stay visible but inert while the connection is down (S8.1). */
  connected: boolean;
  onRename: (columnId: string, name: string) => Promise<void>;
  /** `null` means "to the end", matching the API's `beforeColumnId`. */
  onMove: (columnId: string, beforeColumnId: string | null) => Promise<void>;
  onSetLimits: (columnId: string, request: SetColumnLimitsRequest) => Promise<void>;
  onDelete: (columnId: string) => Promise<void>;
  onAdd: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const newNameId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialog({ containerRef: panelRef, onClose });

  async function run(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;

    // Moving down past the last column means "to the end", which the API says
    // with a null. Otherwise it is "before whoever now occupies that slot" —
    // one further along when moving down, because the column being moved is
    // still counted in the list it is leaving.
    const before =
      direction === -1
        ? columns[target].id
        : target + 1 < columns.length
          ? columns[target + 1].id
          : null;

    void run(() => onMove(columns[index].id, before));
  }

  async function add() {
    const name = newName.trim();
    if (!name || adding) return;

    setAdding(true);
    try {
      await run(async () => {
        await onAdd(name);
        setNewName("");
      });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 lg:p-8 lg:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[620px] max-h-[88vh] flex flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-border shrink-0">
          <h2 id={titleId} className="text-[15px] font-semibold flex-1">
            Board settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Columns
            </h3>
            <p className="text-[12px] text-text-muted leading-relaxed">
              The order here is the order on the board. A card limit is a signal, not a rule —
              cards can still be moved into a full column.
            </p>
          </div>

          <ul className="flex flex-col gap-1.5">
            {columns.map((column, i) => (
              <li
                key={column.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1.5"
              >
                <div className="flex flex-col shrink-0">
                  <Nudge
                    label={`Move ${column.name} earlier`}
                    disabled={i === 0 || !connected}
                    onClick={() => move(i, -1)}
                    direction="up"
                  />
                  <Nudge
                    label={`Move ${column.name} later`}
                    disabled={i === columns.length - 1 || !connected}
                    onClick={() => move(i, 1)}
                    direction="down"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <InlineEdit
                    label={`Column ${column.name}`}
                    value={column.name}
                    readOnly={!connected}
                    onCommit={(next) => onRename(column.id, next)}
                    className="[&_button]:font-medium"
                  />
                </div>

                {/* Every column's limits in one column of the list, because a
                    limit is a statement about flow through the whole board and
                    one cannot be judged without the others. */}
                <LimitFields
                  column={column}
                  disabled={!connected}
                  onSetLimits={(request) => onSetLimits(column.id, request)}
                />

                <button
                  type="button"
                  onClick={() => void run(() => onDelete(column.id))}
                  disabled={!connected}
                  aria-label={`Delete ${column.name}`}
                  className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-text-dim hover:text-danger hover:bg-surface transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 3h8M4.5 3V2a1 1 0 011-1h1a1 1 0 011 1v1M3 3l.5 7a1 1 0 001 1h3a1 1 0 001-1L9 3"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="flex items-center gap-2 pt-1"
          >
            <label className="sr-only" htmlFor={newNameId}>
              New column name
            </label>
            <input
              id={newNameId}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={!connected}
              placeholder="Add a column"
              className="flex-1 text-[13px] bg-surface-2 border border-border rounded-md px-2.5 py-1.5 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim disabled:opacity-50"
            />
            <Button type="submit" size="sm" disabled={!newName.trim() || adding || !connected}>
              {adding ? "Adding…" : "Add"}
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-[11px] text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Nudge({
  label,
  disabled,
  onClick,
  direction,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  direction: "up" | "down";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-5 h-4 flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-surface transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        className={direction === "up" ? "rotate-180" : ""}
      >
        <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/**
 * A column's min and max, edited in place.
 *
 * Strings rather than numbers, for the same reason the standalone dialog uses
 * them: `0` and `""` are different answers — a maximum of zero says "nothing
 * should be in progress in this stage", and empty says "do not limit this".
 */
function LimitFields({
  column,
  disabled,
  onSetLimits,
}: {
  column: ColumnWithCardsResponse;
  disabled: boolean;
  onSetLimits: (request: SetColumnLimitsRequest) => Promise<void>;
}) {
  const [min, setMin] = useState(column.minCards === null ? "" : String(column.minCards));
  const [max, setMax] = useState(column.maxCards === null ? "" : String(column.maxCards));

  const state = limitState(column.cards.length, column);

  function commit(nextMin: string, nextMax: string) {
    const parsed = (v: string) => (v.trim() === "" ? null : Number(v));
    const minValue = parsed(nextMin);
    const maxValue = parsed(nextMax);

    // Left for the server to refuse rather than silently corrected — quietly
    // swapping someone's numbers is worse than telling them.
    if (minValue !== null && maxValue !== null && minValue > maxValue) return;
    if (minValue === column.minCards && maxValue === column.maxCards) return;

    void onSetLimits({
      minCards: minValue,
      maxCards: maxValue,
      clearMinCards: minValue === null,
      clearMaxCards: maxValue === null,
    });
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span
        className={`text-[11px] tabular-nums w-12 text-right ${
          state === "over" ? "text-danger" : state === "under" ? "text-warn" : "text-text-dim"
        }`}
      >
        {limitLabel(column, column.cards.length) ?? `${column.cards.length}`}
      </span>
      <LimitInput
        label={`Minimum cards in ${column.name}`}
        value={min}
        disabled={disabled}
        onChange={setMin}
        onCommit={() => commit(min, max)}
      />
      <span aria-hidden="true" className="text-text-dim text-[11px]">
        –
      </span>
      <LimitInput
        label={`Maximum cards in ${column.name}`}
        value={max}
        disabled={disabled}
        onChange={setMax}
        onCommit={() => commit(min, max)}
      />
    </div>
  );
}

function LimitInput({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
      }}
      disabled={disabled}
      inputMode="numeric"
      aria-label={label}
      placeholder="–"
      className="w-9 text-[12px] text-center bg-surface border border-border rounded px-1 py-0.5 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim disabled:opacity-50"
    />
  );
}
