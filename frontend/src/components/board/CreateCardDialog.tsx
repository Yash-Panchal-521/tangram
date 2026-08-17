"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { LabelPicker } from "@/components/board/detail/LabelPicker";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { matchesFilter, type BoardFilter } from "@/lib/boardFilter";
import { PRIORITIES } from "@/lib/priority";
import { useDialog } from "@/lib/useDialog";
import type {
  CardPriority,
  CardResponse,
  CreateCardRequest,
  LabelColor,
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
  onCreateLabel,
  onDeleteLabel,
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
  /** Adds to the board's vocabulary — the picker here creates as well as applies. */
  onCreateLabel: (name: string, color: LabelColor) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
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

  // No stand-down for the label picker. `useDialog` keeps a stack and only the
  // topmost dialog answers a key, so the picker takes its own Escape without
  // this one hearing about it — the same reason the card drawer passes it no
  // open/close handler either.
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
        className="relative w-full max-w-[680px] max-h-[88vh] flex flex-col rounded-[3px] border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col min-h-0"
        >
          <div className="px-[30px] pt-5 pb-4 border-b border-border shrink-0">
            <h2 id={titleId} className="text-[10.5px] uppercase tracking-[0.12em] text-text-dim font-semibold">
              New card
            </h2>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-[30px] py-7 flex flex-col gap-6">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.11em] text-text-dim">Title</span>
              <input
                id={titleFieldId}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                data-focus-ring="none"
                className="w-full bg-transparent border-b border-border pb-2 text-[26px] leading-tight tracking-[-0.012em] outline-none transition-colors focus-visible:border-accent focus-visible:shadow-[inset_0_-1px_0_0_var(--accent)] placeholder:text-text-dim"
                style={{ fontFamily: "var(--font-display)" }}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.11em] text-text-dim">Description</span>
              <textarea
                id={descriptionId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Optional"
                className="w-full text-sm bg-surface-2 border border-border rounded-[2px] px-3 py-2.5 outline-none transition-colors focus-visible:border-accent resize-none leading-[1.7] placeholder:text-text-dim"
              />
            </label>

            <div className="grid grid-cols-[86px_minmax(0,1fr)] sm:grid-cols-[86px_minmax(0,1fr)_86px_minmax(0,1fr)] items-center gap-x-3 gap-y-3.5 pt-1">
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

            {/* The same picker the card drawer uses, which both applies labels
                and creates them. It used to be a row of toggles over the
                board's existing vocabulary, on the argument that inventing
                vocabulary is not what someone is doing here — but a label is
                almost always invented at the moment you want to apply it, and
                the alternative was: create the card, reopen it, add the label
                there. Two steps for something you knew before you started
                typing.

                Rendered unconditionally. Gated on the board already having
                labels, the whole row vanished on a new board — so the one place
                a first label is most likely to be invented was the one place
                offering no way to do it. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.11em] text-text-dim">Labels</span>
              <LabelPicker
                available={labels}
                selected={labels.filter((l) => labelIds.includes(l.id))}
                readOnly={false}
                // Local, not a request: the card does not exist yet, so the chosen set
                // rides along in the create call rather than being applied to anything.
                onApply={async (ids) => setLabelIds(ids)}
                onCreate={onCreateLabel}
                onDelete={onDeleteLabel}
              />
            </div>

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

          <div className="flex items-center justify-end gap-2.5 px-[30px] py-4 border-t border-border bg-surface-2 shrink-0">
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
      <span className="text-[10px] uppercase tracking-[0.11em] text-text-dim">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}
