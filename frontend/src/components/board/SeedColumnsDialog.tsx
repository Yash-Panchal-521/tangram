"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BOARD_TEMPLATES } from "@/lib/boardTemplates";
import { columnNamesProblem, parseColumnNames } from "@/lib/columnNames";
import { useDialog } from "@/lib/useDialog";

/**
 * Giving an empty board its columns, in one pass.
 *
 * A board with no columns is not a board yet, and the old path — add one, name
 * it, add another, name that — asked someone to build a workflow one field at a
 * time before they had seen the thing work. Templates make the common shapes a
 * single click; the custom field takes the whole workflow as one line, because
 * anyone who already knows their stages can type them faster than they can
 * click four times.
 *
 * The templates are the same ones the welcome flow offers, deliberately: a
 * board created later should be able to look like the first one without the
 * person having to remember what it was called.
 */
export function SeedColumnsDialog({
  onCreate,
  onClose,
}: {
  /** Must reject on failure — the dialog stays open and says why (S3.2). */
  onCreate: (names: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const customId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Which template is chosen, or "custom". Starts on the first, so the primary
  // action is never disabled on arrival — an empty board is the one moment
  // where having to make a choice before anything happens is worst.
  const [choice, setChoice] = useState<string>(BOARD_TEMPLATES[0].id);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialog({ containerRef: panelRef, onClose });

  const template = BOARD_TEMPLATES.find((t) => t.id === choice);
  const names = template ? template.columns : parseColumnNames(custom);
  // Held back until something has been typed: telling someone their empty field
  // is empty, before they have touched it, is not help.
  const problem = template || custom.trim() === "" ? null : columnNamesProblem(names);

  async function submit() {
    if (saving || names.length === 0 || problem) return;

    setSaving(true);
    setError(null);
    try {
      await onCreate(names);
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
        className="relative w-full max-w-[540px] max-h-[88vh] flex flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col min-h-0"
        >
          <div className="px-5 pt-4 pb-3 border-b border-border shrink-0 flex flex-col gap-1">
            <h2 id={titleId} className="text-[15px] font-semibold">
              Add columns
            </h2>
            <p className="text-[13px] text-text-muted leading-relaxed">
              Columns are the stages work moves through. Start from a shape, or name your own.
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2">
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Starting shape</legend>

              {BOARD_TEMPLATES.map((t) => (
                <Choice
                  key={t.id}
                  name="shape"
                  checked={choice === t.id}
                  onSelect={() => setChoice(t.id)}
                  label={t.name}
                  hint={t.description}
                >
                  <div className="flex flex-wrap gap-1 pt-1.5">
                    {t.columns.map((c) => (
                      <span
                        key={c}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </Choice>
              ))}

              <Choice
                name="shape"
                checked={choice === "custom"}
                onSelect={() => setChoice("custom")}
                label="Custom"
                hint="Type the stages in order, separated by commas."
              >
                {choice === "custom" && (
                  <div className="flex flex-col gap-1.5 pt-2">
                    <label className="sr-only" htmlFor={customId}>
                      Column names, separated by commas
                    </label>
                    <input
                      id={customId}
                      autoFocus
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      placeholder="To Do, In Progress, Done"
                      className="w-full text-[13px] bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
                    />

                    {/* The parse shown back rather than described. A trailing
                        comma and a repeated name both do something quiet, and
                        this is where someone finds out. */}
                    {names.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {names.map((n, i) => (
                          <span key={n} className="flex items-center gap-1">
                            {i > 0 && (
                              <span aria-hidden="true" className="text-text-dim text-[10px]">
                                →
                              </span>
                            )}
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 border border-border">
                              {n}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}

                    {problem && (
                      <p role="alert" className="text-[11px] text-danger">
                        {problem}
                      </p>
                    )}
                  </div>
                )}
              </Choice>
            </fieldset>

            {error && (
              <p role="alert" className="text-[11px] text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border bg-surface-2 shrink-0">
            <span className="flex-1 text-[11px] text-text-dim tabular-nums">
              {names.length > 0 && `${names.length} column${names.length === 1 ? "" : "s"}`}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || names.length === 0 || !!problem}>
              {saving ? "Adding…" : "Add columns"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Choice({
  name,
  checked,
  onSelect,
  label,
  hint,
  children,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    // A real radio, so arrow keys move between shapes and a screen reader says
    // "2 of 4" — a row of divs with click handlers gives neither.
    <label
      className={`flex gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-2"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 accent-accent cursor-pointer"
      />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[12px] text-text-muted leading-relaxed">{hint}</span>
        {children}
      </span>
    </label>
  );
}
