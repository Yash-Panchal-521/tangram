import { labelChipStyle } from "@/lib/labelColors";
import type { LabelResponse } from "@/lib/api";

/**
 * A label, as a chip.
 *
 * The name is always rendered, never colour alone. Seven hues at chip size are
 * not reliably distinguishable — and two people can pick colours that read
 * identically to someone who cannot separate them — so the colour is a second
 * signal on top of the word, not a replacement for it.
 */
export function LabelChip({
  label,
  onRemove,
  size = "md",
}: {
  label: LabelResponse;
  /** Adds a remove affordance. Omitted on the board face, where there is no room. */
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const text = size === "sm" ? "text-[10px] px-1.5 py-0" : "text-[11px] px-2 py-0.5";

  return (
    <span
      style={labelChipStyle(label.color)}
      className={`inline-flex items-center gap-1 rounded-full border font-medium max-w-full ${text}`}
    >
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label.name}`}
          className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M1 1L11 11M11 1L1 11"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
