"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { LabelChip } from "@/components/ui/LabelChip";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { matchesFilter, type BoardFilter } from "@/lib/boardFilter";
import { PRIORITIES } from "@/lib/priority";
import { useDialog } from "@/lib/useDialog";
import type {
  CardPriority,
  CardResponse,
  CreateCardRequest,
  LabelResponse,
  MemberResponse,
} from "@/lib/api";
import type { StatusOption } from "@/components/board/detail/ContextPanel";

/**
 * One dialog for making a card, reached from the board header or `c`.
 *
 * Replaces a button at the foot of every column. Jira's primary path is a single
 * **Create** in the navigation opening a compact dialog — its per-column inline
 * create exists but is the hedged one, requiring a system setting, global
 * transitions without validators, particular swimlane groupings, and the default
 * board filter. One control is also simply less furniture: an "add" button in
 * each of six columns is six buttons saying the same thing.
 *
 * Every field is here because there is no expand-to-full-form. A card made in
 * one pass does not need opening and editing three times, which is what creating
 * one used to cost.
 */
export function CreateCardDialog({
  statuses,
  members,
  labels,
  defaultColumnId,
  filter,
  filterActive,
  onCreate,
  onClearFilter,
  onClose,
}: {
  statuses: StatusOption[];
  members: MemberResponse[];
  labels: LabelResponse[];
  /** Where the card lands unless it is changed — the first column, usually. */
  defaultColumnId: string;
  /** The board's active filter, to warn when the new card would land hidden. */
  filter: BoardFilter;
  filterActive: boolean;
  /** Must reject on failure — the dialog stays open and says why (S3.2). */
  onCreate: (columnId: string, request: CreateCardRequest) => Promise<void>;
  onClearFilter: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const titleFieldId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [columnId, setColumnId] = useState(defaultColumnId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialog({ containerRef: panelRef, onClose });

  /**
   * Whether the card being described would survive the board's filter.
   *
   * Jira refuses inline creation on a filtered board rather than solve this.
   * Refusing reads as broken when you cannot see the cause, so the card is
   * created either way and this says what will happen first — checked against
   * the same `matchesFilter` the board itself uses, so the two cannot drift.
   */
  const willBeHidden = useMemo(() => {
    if (!filterActive) return false;

    const preview: CardResponse = {
      id: "preview",
      columnId,
      title,
      description: description || null,
      rank: "",
      dueAt: dueAt ? `${dueAt}T00:00:00.000Z` : null,
      assigneeId: assigneeId || null,
      createdAt: new Date(0).toISOString(),
      // Its own creation instant, so "recently updated" reads true of it.
      updatedAt: new Date(0).toISOString(),
      priority: (priority || null) as CardPriority | null,
      labels: labels.filter((l) => labelIds.includes(l.id)),
      commentCount: 0,
    };

    // `recent` is the one criterion a new card always satisfies, and the
    // preview's timestamps are fixed, so it is excluded rather than faked.
    return !matchesFilter(preview, { ...filter, recent: false }, Date.parse(preview.updatedAt));
  }, [filterActive, filter, columnId, title, description, dueAt, assigneeId, priority, labelIds, labels]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);
    try {
      await onCreate(columnId, {
        title: trimmed,
        description: description.trim() || null,
        assigneeId: assigneeId || null,
        priority: (priority || null) as CardPriority | null,
        dueAt: dueAt ? `${dueAt}T00:00:00.000Z` : null,
        labelIds,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
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
        className="relative w-full max-w-[520px] max-h-[88vh] flex flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col min-h-0"
        >
          <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
            <h2 id={titleId} className="text-[15px] font-semibold">
              New card
            </h2>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-muted">Title</span>
              <input
                id={titleFieldId}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                className="w-full text-[13px] bg-surface-2 border border-border rounded-md px-2.5 py-2 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-muted">Description</span>
              <textarea
                id={descriptionId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional"
                className="w-full text-[13px] bg-surface-2 border border-border rounded-md px-2.5 py-2 outline-none transition-colors focus-visible:border-accent resize-none leading-relaxed placeholder:text-text-dim"
              />
            </label>

            <div className="grid grid-cols-[72px_1fr] items-center gap-x-2.5 gap-y-1.5">
              <Field label="Status">
                <SelectMenu
                  label="Status"
                  value={columnId}
                  options={statuses.map((s) => ({ value: s.id, label: s.name }))}
                  onChange={setColumnId}
                />
              </Field>

              <Field label="Assignee">
                <SelectMenu
                  label="Assignee"
                  value={assigneeId}
                  options={[
                    { value: "", label: "Unassigned", muted: true },
                    ...members.map((m) => ({
                      value: m.userId,
                      label: m.displayName,
                      icon: <Avatar name={m.displayName} size="sm" />,
                    })),
                  ]}
                  onChange={setAssigneeId}
                />
              </Field>

              <Field label="Priority">
                <SelectMenu
                  label="Priority"
                  value={priority}
                  options={[
                    { value: "", label: "None", muted: true },
                    ...PRIORITIES.map((p) => ({
                      value: p as string,
                      label: p,
                      icon: <PriorityIcon priority={p} />,
                    })),
                  ]}
                  onChange={setPriority}
                />
              </Field>

              <Field label="Due">
                <DatePicker variant="quiet" value={dueAt} onChange={setDueAt} />
              </Field>
            </div>

            {labels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">Labels</span>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => {
                    const on = labelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setLabelIds((ids) =>
                            on ? ids.filter((v) => v !== label.id) : [...ids, label.id]
                          )
                        }
                        // Toggled in place rather than behind the card detail's
                        // picker: that one also *creates* labels, and inventing
                        // vocabulary is not what someone is doing here.
                        className={`rounded-full transition-opacity cursor-pointer ${
                          on ? "opacity-100" : "opacity-45 hover:opacity-75"
                        }`}
                      >
                        <LabelChip label={label} size="sm" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {willBeHidden && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 px-2.5 py-2 text-[12px] text-text-muted"
              >
                <span className="flex-1 leading-relaxed">
                  The board&apos;s filter will hide this card as soon as it&apos;s made.
                </span>
                <button
                  type="button"
                  onClick={onClearFilter}
                  className="shrink-0 font-medium text-accent hover:underline cursor-pointer"
                >
                  Clear filter
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="text-[11px] text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-surface-2 shrink-0">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim()}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}
