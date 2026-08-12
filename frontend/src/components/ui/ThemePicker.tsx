"use client";

import { THEMES, useTheme, type ThemeName } from "@/lib/theme";

/**
 * Switches the whole app's palette.
 *
 * Every surface is built on the same token names, so this changes one attribute
 * on `<html>` and nothing else — no component knows a colour. That was true
 * before this existed; the picker is what makes it demonstrable.
 *
 * Each option shows its own colours rather than only its name. A list of words
 * cannot answer "which of these do I want", and reading the swatches is the
 * whole point of a picker for exploring rather than for setting.
 */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, mode, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={compact ? "flex flex-col gap-0.5" : "flex flex-col gap-1.5"}
    >
      {THEMES.map((option) => (
        <Option
          key={option.id}
          option={option}
          mode={mode}
          selected={option.id === theme}
          compact={compact}
          onSelect={() => setTheme(option.id)}
        />
      ))}
    </div>
  );
}

function Option({
  option,
  mode,
  selected,
  compact,
  onSelect,
}: {
  option: { id: ThemeName; name: string; hint: string };
  mode: string;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${
        selected ? "bg-accent/10" : "hover:bg-surface-2"
      }`}
    >
      {/* Rendered inside its own palette rather than the active one: a swatch
          painted in the current theme's colours would show every option the
          same, which is the one thing a theme picker must not do. The nested
          data attributes re-scope the tokens for this subtree only. */}
      <span
        data-theme={option.id}
        data-mode={mode}
        aria-hidden="true"
        className="shrink-0 flex items-center rounded-md overflow-hidden border border-border"
      >
        <span className="w-4 h-5 bg-bg" />
        <span className="w-4 h-5 bg-surface-2" />
        <span className="w-4 h-5 bg-accent" />
      </span>

      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-medium truncate">{option.name}</span>
        {!compact && (
          <span className="text-[11px] text-text-muted truncate">{option.hint}</span>
        )}
      </span>

      {selected && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className="shrink-0 text-accent"
        >
          <path
            d="M2.5 6.2l2.2 2.2 4.8-4.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
