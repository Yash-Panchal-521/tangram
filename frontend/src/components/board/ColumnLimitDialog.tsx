"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDialog } from "@/lib/useDialog";
import type { SetColumnLimitsRequest } from "@/lib/api";

/**
 * Setting a column's work-in-progress limits.
 *
 * Empty means no limit, which is why both fields are strings here rather than
 * numbers: `0` and `""` are different answers — a maximum of zero says "nothing
 * should be in progress in this stage", and an empty field says "do not limit
 * this at all". Coercing through a number would collapse them.
 */
export function ColumnLimitDialog({
  columnName,
  minCards,
  maxCards,
  onSave,
  onClose,
}: {
  columnName: string;
  minCards: number | null;
  maxCards: number | null;
  /** Must reject on failure — the dialog stays open and explains (S3.2). */
  onSave: (request: SetColumnLimitsRequest) => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const minId = useId();
  const maxId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [min, setMin] = useState(minCards === null ? "" : String(minCards));
  const [max, setMax] = useState(maxCards === null ? "" : String(maxCards));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDialog({ containerRef: panelRef, onClose });

  const parsed = (value: string) => (value.trim() === "" ? null : Number(value));
  const minValue = parsed(min);
  const maxValue = parsed(max);

  // Checked here as well as on the server, because the server's answer costs a
  // round trip and arrives after the dialog has already accepted the numbers.
  const inverted = minValue !== null && maxValue !== null && minValue > maxValue;
  const negative = (minValue ?? 0) < 0 || (maxValue ?? 0) < 0;

  async function save() {
    if (inverted || negative || saving) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        minCards: minValue,
        maxCards: maxValue,
        // Explicit, because absent means "leave alone" — emptying a field has
        // to say so, or clearing a limit would silently do nothing.
        clearMinCards: minValue === null,
        clearMaxCards: maxValue === null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[380px] rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="px-5 pt-5 pb-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 id={titleId} className="text-[15px] font-semibold leading-snug">
                Card limits for {columnName}
              </h2>
              <p className="text-[13px] text-text-muted leading-relaxed">
                A limit is a signal, not a rule — cards can still be moved into a full column.
                Leave a field empty for no limit.
              </p>
            </div>

            <div className="flex gap-3">
              <label className="flex-1 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">Minimum</span>
                <input
                  id={minId}
                  value={min}
                  onChange={(e) => setMin(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="None"
                  className="w-full text-[13px] bg-surface-2 border border-border rounded-md px-2.5 py-1.5 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
                />
              </label>
              <label className="flex-1 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">Maximum</span>
                <input
                  id={maxId}
                  value={max}
                  onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="None"
                  className="w-full text-[13px] bg-surface-2 border border-border rounded-md px-2.5 py-1.5 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
                />
              </label>
            </div>

            {inverted && (
              <p role="alert" className="text-[11px] text-danger">
                The minimum can&apos;t be more than the maximum.
              </p>
            )}
            {error && (
              <p role="alert" className="text-[11px] text-danger">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-surface-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {/* Disabled only while the numbers contradict each other, which is a
                transient state the person can fix in the field in front of them
                (S8.1). */}
            <Button type="submit" size="sm" disabled={saving || inverted}>
              {saving ? "Saving…" : "Save limits"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
