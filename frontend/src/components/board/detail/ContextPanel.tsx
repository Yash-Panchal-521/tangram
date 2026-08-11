"use client";

import { useId, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { ContextRow } from "@/components/board/detail/ContextRow";
import { dueLabel, formatDueDate, toDateInputValue } from "@/lib/dueDate";
import { PRIORITIES } from "@/lib/priority";
import type { CardPriority, CardResponse, MemberResponse } from "@/lib/api";

/** A column, reduced to what the status control needs. */
export interface StatusOption {
  id: string;
  name: string;
}

/**
 * The right-hand column — "context fields" in Jira's language: the secondary
 * information you sort and filter by, as opposed to the description, which is
 * what the work actually is.
 *
 * Jira splits these into a **Details** group that is always visible and a
 * **More fields** group hidden behind a divider when its fields are empty. That
 * is not decoration: it keeps the column short for the common card while still
 * having somewhere to put the rest. Reproduced here, with created/updated as the
 * "more" group since they are never empty but are rarely what you came for.
 */
export function ContextPanel({
  card,
  readOnly,
  members,
  statuses,
  onCommit,
  onMove,
}: {
  card: CardResponse;
  readOnly: boolean;
  members: MemberResponse[];
  statuses: StatusOption[];
  onCommit: (update: {
    assigneeId?: string | null;
    clearAssignee?: boolean;
    dueAt?: string | null;
    clearDueAt?: boolean;
    priority?: CardPriority | null;
    clearPriority?: boolean;
  }) => Promise<void>;
  onMove: (targetColumnId: string) => Promise<void>;
}) {
  const statusId = useId();
  const assigneeId = useId();
  const dueId = useId();
  const priorityId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Someone who has left the workspace no longer resolves. Showing the raw id
  // would be noise; "Unassigned" would be a lie that the next save makes true.
  const assigneeName = members.find((m) => m.userId === card.assigneeId)?.displayName ?? null;
  const assigneeMissing = card.assigneeId !== null && assigneeName === null;

  async function run(field: string, work: () => Promise<void>) {
    setPending(field);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        Details
      </h3>

      <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2/40 p-3">
        <ContextRow label="Status" htmlFor={readOnly ? undefined : statusId}>
          {readOnly ? (
            <p className="text-[13px] pt-1.5">
              {statuses.find((s) => s.id === card.columnId)?.name ?? "—"}
            </p>
          ) : (
            <Select
              id={statusId}
              value={card.columnId}
              disabled={pending === "status"}
              onChange={(e) => void run("status", () => onMove(e.target.value))}
              className="bg-surface"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </ContextRow>

        <ContextRow label="Assignee" htmlFor={readOnly ? undefined : assigneeId}>
          {readOnly ? (
            <div className="flex items-center gap-2 pt-1">
              {assigneeName ? (
                <>
                  <Avatar name={assigneeName} size="sm" />
                  <span className="text-[13px] truncate">{assigneeName}</span>
                </>
              ) : (
                <span className="text-[13px] text-text-dim italic">Unassigned</span>
              )}
            </div>
          ) : (
            <Select
              id={assigneeId}
              value={card.assigneeId ?? ""}
              disabled={pending === "assignee"}
              onChange={(e) =>
                void run("assignee", () =>
                  onCommit({
                    assigneeId: e.target.value || null,
                    clearAssignee: e.target.value === "",
                  })
                )
              }
              className="bg-surface"
            >
              <option value="">Unassigned</option>
              {/* Kept visible rather than silently collapsing to "Unassigned",
                  which would make the next save clear an assignment nobody
                  chose to clear. */}
              {assigneeMissing && (
                <option value={card.assigneeId!}>Someone who has left the workspace</option>
              )}
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </Select>
          )}
        </ContextRow>

        <ContextRow label="Priority" htmlFor={readOnly ? undefined : priorityId}>
          {readOnly ? (
            <div className="flex items-center gap-1.5 pt-1.5">
              {card.priority ? (
                <>
                  <PriorityIcon priority={card.priority} />
                  <span className="text-[13px]">{card.priority}</span>
                </>
              ) : (
                <span className="text-[13px] text-text-dim italic">None</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {/* Beside the control rather than inside it: a native select
                  cannot render an icon in its options, and the value is what
                  people scan for. */}
              {card.priority && <PriorityIcon priority={card.priority} />}
              <Select
                id={priorityId}
                value={card.priority ?? ""}
                disabled={pending === "priority"}
                onChange={(e) =>
                  void run("priority", () =>
                    onCommit({
                      priority: (e.target.value || null) as CardPriority | null,
                      clearPriority: e.target.value === "",
                    })
                  )
                }
                className="bg-surface"
              >
                <option value="">None</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </ContextRow>

        <ContextRow label="Due" htmlFor={readOnly ? undefined : dueId}>
          {readOnly ? (
            <p className={`text-[13px] pt-1.5 ${card.dueAt ? "text-text" : "text-text-dim italic"}`}>
              {card.dueAt ? `${formatDueDate(card.dueAt)} · ${dueLabel(card.dueAt)}` : "No due date"}
            </p>
          ) : (
            <DatePicker
              id={dueId}
              value={toDateInputValue(card.dueAt)}
              onChange={(next) =>
                void run("due", () =>
                  onCommit({
                    dueAt: next ? `${next}T00:00:00.000Z` : null,
                    clearDueAt: next === "",
                  })
                )
              }
            />
          )}
        </ContextRow>

        {error && (
          <p role="alert" className="text-[11px] text-danger">
            {error}
          </p>
        )}
      </div>

      {/* Jira's "hide when empty" divider. These are never what someone opened
          the card for, so they start folded rather than pushing the fields that
          matter off the top. */}
      <button
        type="button"
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={moreOpen}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-dim hover:text-text-muted transition-colors cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`transition-transform ${moreOpen ? "rotate-90" : ""}`}
        >
          <path
            d="M4.5 2l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        More fields
      </button>

      {moreOpen && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-2/40 p-3 animate-[fade-up_0.15s_ease-out]">
          <ContextRow label="Created">
            <p className="text-[13px] pt-1.5">{formatDueDate(card.createdAt)}</p>
          </ContextRow>
          <ContextRow label="Updated">
            <p className="text-[13px] pt-1.5">{formatDueDate(card.updatedAt)}</p>
          </ContextRow>
        </div>
      )}
    </div>
  );
}
