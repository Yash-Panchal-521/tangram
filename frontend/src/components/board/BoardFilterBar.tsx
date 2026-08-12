"use client";

import { Avatar } from "@/components/ui/Avatar";
import { LabelChip } from "@/components/ui/LabelChip";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { isFilterActive, type BoardFilter } from "@/lib/boardFilter";
import type { LabelResponse, MemberResponse } from "@/lib/api";

/**
 * The board's filter controls.
 *
 * Jira ships two quick filters by default — "Only My Work items"
 * (`assignee = currentUser()`) and "Recently Updated" (`updatedDate >= -1d`).
 * The second is here as a toggle. The first is not, because it would be a second
 * way to say what the avatar row already says: your own face is first in the
 * row, so "only my cards" is one click on it. Two controls that set the same
 * state disagree the moment someone uses both.
 *
 * Everything is additive across kinds and permissive within one: two people
 * means either of them, two labels means either of them, but a person *and* a
 * label means both must hold. That is what people expect of a filter row, and it
 * is the only combination where adding a control never widens the result.
 */
export function BoardFilterBar({
  filter,
  members,
  labels,
  currentUserId,
  matches,
  total,
  onChange,
  onClear,
}: {
  filter: BoardFilter;
  members: MemberResponse[];
  labels: LabelResponse[];
  /** Sorted first in the avatar row, because filtering to yourself is common. */
  currentUserId: string | null;
  /** Cards the filter leaves, and cards the board has. */
  matches: number;
  total: number;
  onChange: (next: BoardFilter) => void;
  onClear: () => void;
}) {
  const active = isFilterActive(filter);

  const ordered = [...members].sort((a, b) =>
    a.userId === currentUserId ? -1 : b.userId === currentUserId ? 1 : 0
  );

  function toggle(key: "assignees" | "labels", id: string) {
    const current = filter[key];
    onChange({
      ...filter,
      [key]: current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    });
  }

  return (
    <div className="shrink-0 flex items-center gap-2 flex-wrap px-4.5 py-2 border-b border-border bg-surface">
      <label className="relative">
        <span className="sr-only">Search cards</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
        >
          <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          value={filter.text}
          onChange={(e) => onChange({ ...filter, text: e.target.value })}
          placeholder="Search cards"
          className="w-[190px] text-[13px] bg-surface-2 border border-border rounded-md pl-7.5 pr-2 py-1 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
        />
      </label>

      {ordered.length > 0 && (
        <div className="flex items-center -space-x-1.5">
          {ordered.map((m) => {
            const on = filter.assignees.includes(m.userId);
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => toggle("assignees", m.userId)}
                aria-pressed={on}
                title={m.userId === currentUserId ? `${m.displayName} (you)` : m.displayName}
                aria-label={`Only cards assigned to ${m.displayName}`}
                // Selection is a ring rather than an opacity change: dimming the
                // unselected ones makes a filtered row look disabled, and there
                // is no state here where these controls stop working.
                className={`rounded-full transition-transform cursor-pointer hover:z-10 hover:-translate-y-0.5 ${
                  on ? "ring-2 ring-accent z-10 -translate-y-0.5" : "ring-2 ring-surface"
                }`}
              >
                <Avatar name={m.displayName} size="sm" />
              </button>
            );
          })}
        </div>
      )}

      {labels.length > 0 && (
        <Menu label="Filter by label" align="left">
          {() => (
            <>
              {labels.map((l) => (
                <MenuItem key={l.id} onSelect={() => toggle("labels", l.id)}>
                  <span className="flex items-center gap-2">
                    {/* A checkbox rather than a highlight: the menu stays open
                        for several picks, so each row has to say its own state
                        without relying on which one you touched last. */}
                    <span
                      aria-hidden="true"
                      className={`w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0 ${
                        filter.labels.includes(l.id)
                          ? "bg-accent border-accent text-accent-fg"
                          : "border-border"
                      }`}
                    >
                      {filter.labels.includes(l.id) && (
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.2l2.2 2.2 4.8-4.8"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <LabelChip label={l} size="sm" />
                  </span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      )}

      <FilterToggle
        on={filter.recent}
        onClick={() => onChange({ ...filter, recent: !filter.recent })}
      >
        Recently updated
      </FilterToggle>

      <div className="flex-1" />

      {active && (
        <>
          {/* Said out loud, because a filtered board and a nearly empty one look
              identical — and the second is the more alarming reading (S2.3). */}
          <span className="text-[11px] text-text-muted tabular-nums" role="status">
            {matches} of {total}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] font-medium px-2 py-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

function FilterToggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      // Per-branch class sets, never appended: `cn()` resolves no Tailwind
      // conflicts, so a second `bg-*`/`border-*` would be decided by stylesheet
      // order (S1.3).
      className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
        on
          ? "bg-accent border-accent text-accent-fg"
          : "bg-surface-2 border-border text-text-muted hover:text-text hover:border-border-2"
      }`}
    >
      {children}
    </button>
  );
}
