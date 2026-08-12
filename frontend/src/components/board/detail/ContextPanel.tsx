"use client";

import { useId, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { DatePicker } from "@/components/ui/DatePicker";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { ContextRow } from "@/components/board/detail/ContextRow";
import { LabelPicker } from "@/components/board/detail/LabelPicker";
import { dueLabel, formatDueDate, toDateInputValue } from "@/lib/dueDate";
import { PRIORITIES } from "@/lib/priority";
import type {
  CardPriority,
  CardResponse,
  LabelColor,
  LabelResponse,
  MemberResponse,
} from "@/lib/api";

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
  labels,
  onCommit,
  onMove,
  onCreateLabel,
  onDeleteLabel,
}: {
  card: CardResponse;
  readOnly: boolean;
  members: MemberResponse[];
  statuses: StatusOption[];
  /** The board's whole label vocabulary, for the picker. */
  labels: LabelResponse[];
  onCommit: (update: {
    assigneeId?: string | null;
    clearAssignee?: boolean;
    dueAt?: string | null;
    clearDueAt?: boolean;
    priority?: CardPriority | null;
    clearPriority?: boolean;
    labelIds?: string[];
  }) => Promise<void>;
  onMove: (targetColumnId: string) => Promise<void>;
  onCreateLabel: (name: string, color: LabelColor) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
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
  const assigneeName =
    members.find((m) => m.userId === card.assigneeId)?.displayName ?? null;
  const assigneeMissing = card.assigneeId !== null && assigneeName === null;

  async function run(field: string, work: () => Promise<void>) {
    setPending(field);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That didn't save. Try again.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
        Details
      </h3>

      {/* No box. The column it sits in has its own border and tint now, and a
          bordered card inside a bordered column is two frames around one set of
          rows. */}
      <div className="flex flex-col gap-1.5">
        <ContextRow label="Status" htmlFor={readOnly ? undefined : statusId}>
          {readOnly ? (
            <p className="text-[13px] leading-[26px] px-2">
              {statuses.find((s) => s.id === card.columnId)?.name ?? "—"}
            </p>
          ) : (
            <SelectMenu
              id={statusId}
              label="Status"
              value={card.columnId}
              disabled={pending === "status"}
              options={statuses.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(next) => void run("status", () => onMove(next))}
            />
          )}
        </ContextRow>

        <ContextRow
          label="Assignee"
          htmlFor={readOnly ? undefined : assigneeId}
        >
          {readOnly ? (
            <div className="flex items-center gap-2 min-h-[26px] px-2">
              {assigneeName ? (
                <>
                  <Avatar name={assigneeName} size="sm" />
                  <span className="text-[13px] truncate">{assigneeName}</span>
                </>
              ) : (
                <span className="text-[13px] text-text-dim italic">
                  Unassigned
                </span>
              )}
            </div>
          ) : (
            <SelectMenu
              id={assigneeId}
              label="Assignee"
              value={card.assigneeId ?? ""}
              disabled={pending === "assignee"}
              options={[
                { value: "", label: "Unassigned", muted: true },
                // Kept visible rather than silently collapsing to "Unassigned",
                // which would make the next save clear an assignment nobody
                // chose to clear.
                ...(assigneeMissing
                  ? [
                      {
                        value: card.assigneeId!,
                        label: "Someone who has left the workspace",
                        muted: true,
                      },
                    ]
                  : []),
                ...members.map((m) => ({
                  value: m.userId,
                  label: m.displayName,
                  // Half the reason this stopped being a native select: an
                  // <option> can hold text and nothing else.
                  icon: <Avatar name={m.displayName} size="sm" />,
                })),
              ]}
              onChange={(next) =>
                void run("assignee", () =>
                  onCommit({ assigneeId: next || null, clearAssignee: next === "" })
                )
              }
            />
          )}
        </ContextRow>

        <ContextRow
          label="Priority"
          htmlFor={readOnly ? undefined : priorityId}
        >
          {readOnly ? (
            <div className="flex items-center gap-1.5 min-h-[26px] px-2">
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
            <SelectMenu
                id={priorityId}
                label="Priority"
                value={card.priority ?? ""}
                disabled={pending === "priority"}
                options={[
                  { value: "", label: "None", muted: true },
                  ...PRIORITIES.map((level) => ({
                    value: level,
                    label: level,
                    // In the rows as well as the trigger now. A native option
                    // list could show neither, which is the other half.
                    icon: <PriorityIcon priority={level} />,
                  })),
                ]}
                onChange={(next) =>
                  void run("priority", () =>
                    onCommit({
                      priority: (next || null) as CardPriority | null,
                      clearPriority: next === "",
                    })
                  )
                }
              />
          )}
        </ContextRow>

        <ContextRow label="Due" htmlFor={readOnly ? undefined : dueId}>
          {readOnly ? (
            <p
              className={`text-[13px] leading-[26px] px-2 ${card.dueAt ? "text-text" : "text-text-dim italic"}`}
            >
              {card.dueAt
                ? `${formatDueDate(card.dueAt)} · ${dueLabel(card.dueAt)}`
                : "No due date"}
            </p>
          ) : (
            <DatePicker
              id={dueId}
              variant="quiet"
              value={toDateInputValue(card.dueAt)}
              onChange={(next) =>
                void run("due", () =>
                  onCommit({
                    dueAt: next ? `${next}T00:00:00.000Z` : null,
                    clearDueAt: next === "",
                  }),
                )
              }
            />
          )}
        </ContextRow>

        <ContextRow label="Labels">
          {/* px-2 to match the padding the quiet fields carry, so chips begin on
              the same vertical line as "Backlog" and "Unassigned" rather than
              eight pixels left of it. */}
          <div className="px-2">
            <LabelPicker
              available={labels}
              selected={card.labels}
              readOnly={readOnly}
              onApply={(labelIds) => onCommit({ labelIds })}
              onCreate={onCreateLabel}
              onDelete={onDeleteLabel}
            />
          </div>
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
        <div className="flex flex-col gap-1.5 animate-[fade-up_0.15s_ease-out]">
          <ContextRow label="Created">
            <p className="text-[13px] leading-[26px] text-text-muted">
              {formatDueDate(card.createdAt)}
            </p>
          </ContextRow>
          <ContextRow label="Updated">
            <p className="text-[13px] leading-[26px] text-text-muted">
              {formatDueDate(card.updatedAt)}
            </p>
          </ContextRow>
        </div>
      )}
    </div>
  );
}
