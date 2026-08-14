"use client";

import { LANE_VIEWS, type LaneView } from "@/lib/boardLanes";
import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { LabelChip } from "@/components/ui/LabelChip";
import { Menu, MenuSeparator } from "@/components/ui/Menu";
import { PriorityIcon } from "@/components/ui/PriorityIcon";
import { isFilterActive, UNASSIGNED, type BoardFilter, type DueWindow } from "@/lib/boardFilter";
import { PRIORITIES } from "@/lib/priority";
import type { CardPriority, LabelResponse, MemberResponse } from "@/lib/api";

const DUE_WINDOWS: { value: DueWindow; label: string }[] = [
  { value: "any", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today or overdue" },
  { value: "week", label: "Due this week" },
  { value: "none", label: "No due date" },
];

/**
 * The board's filter controls.
 *
 * The first version put every choice on the surface — a row of overlapping
 * avatars you toggled, and a bare `⋯` for labels. Both were wrong in the same
 * way: they showed the *options* and hid the *state*. You could not tell what
 * was filtering without opening things, the avatar row grew without bound on a
 * real team, and a `⋯` beside a search box says nothing at all about labels.
 *
 * So: named dropdowns that carry their own count, and one row of removable
 * chips naming exactly what is on. The chips are the important half. A filter
 * you cannot see is a filter you forget you applied, and then the board looks
 * like it has lost half its cards.
 *
 * Jira ships "Only My Work items" as a named quick filter; here your own face is
 * first in the People menu instead, so there is one control holding that state
 * rather than two that can disagree.
 */
export function BoardFilterBar({
  filter,
  members,
  labels,
  currentUserId,
  matches,
  view,
  onViewChange,
  total,
  onChange,
  onClear,
}: {
  filter: BoardFilter;
  members: MemberResponse[];
  labels: LabelResponse[];
  /** Sorted first in the People menu, because filtering to yourself is common. */
  currentUserId: string | null;
  matches: number;
  /** How the board is grouped. Lives here because it sits in this row. */
  view: LaneView;
  onViewChange: (view: LaneView) => void;
  total: number;
  onChange: (next: BoardFilter) => void;
  onClear: () => void;
}) {
  const active = isFilterActive(filter);
  const searchRef = useRef<HTMLInputElement>(null);

  const people = [...members].sort((a, b) =>
    a.userId === currentUserId ? -1 : b.userId === currentUserId ? 1 : 0
  );

  useEffect(() => {
    // `/` focuses search, the convention everywhere a list is searchable. Ignored
    // while typing, or it would swallow the character mid-sentence in a card
    // title — which is exactly how this shortcut usually goes wrong.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;

      e.preventDefault();
      searchRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggle(key: "assignees" | "labels", id: string) {
    const current = filter[key];
    onChange({
      ...filter,
      [key]: current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    });
  }

  function togglePriority(level: CardPriority) {
    const current = filter.priorities;
    onChange({
      ...filter,
      priorities: current.includes(level)
        ? current.filter((p) => p !== level)
        : [...current, level],
    });
  }

  const nameOf = (id: string) =>
    id === UNASSIGNED
      ? "Unassigned"
      : (members.find((m) => m.userId === id)?.displayName ?? "Someone");
  const labelOf = (id: string) => labels.find((l) => l.id === id);

  return (
    <div className="shrink-0 flex items-center gap-3.5 flex-wrap px-[30px] pt-[18px] pb-3.5">
      <label className="relative">
        <span className="sr-only">Search cards</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className="absolute right-0 top-1/2 -translate-y-[9px] text-text-dim pointer-events-none"
        >
          <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          value={filter.text}
          onChange={(e) => onChange({ ...filter, text: e.target.value })}
          // Escape clears rather than closing anything — there is nothing open.
          onKeyDown={(e) => {
            if (e.key === "Escape" && filter.text) {
              e.stopPropagation();
              onChange({ ...filter, text: "" });
            }
          }}
          placeholder="Search cards"
          data-focus-ring="none"
          className="w-[158px] text-[13.5px] bg-transparent border-0 border-b border-text rounded-none pl-0 pr-6 pb-1 outline-none transition-colors focus-visible:border-accent placeholder:text-text-dim"
        />
        {filter.text && (
          <button
            type="button"
            onClick={() => onChange({ ...filter, text: "" })}
            aria-label="Clear search"
            className="absolute right-0 top-1/2 -translate-y-[9px] w-4 h-4 flex items-center justify-center rounded text-text-dim hover:text-text transition-colors cursor-pointer"
          >
            <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </label>

      {people.length > 0 && (
        <Menu
          label="Filter by assignee"
          align="left"
          trigger={
            <>
              People
              <Count n={filter.assignees.length} />
            </>
          }
        >
          {() => (
            <>
              {people.map((m) => (
                <CheckRow
                  key={m.userId}
                  checked={filter.assignees.includes(m.userId)}
                  onSelect={() => toggle("assignees", m.userId)}
                >
                  <Avatar name={m.displayName} size="sm" />
                  <span className="truncate">
                    {m.displayName}
                    {m.userId === currentUserId && (
                      <span className="text-text-dim"> (you)</span>
                    )}
                  </span>
                </CheckRow>
              ))}
              <MenuSeparator />
              {/* In the same list, because it answers the same question.
                  There was no way to ask for it at all before: an empty
                  selection means "everyone", so unassigned work — the work
                  most likely to need picking up — was unfindable. */}
              <CheckRow
                checked={filter.assignees.includes(UNASSIGNED)}
                onSelect={() => toggle("assignees", UNASSIGNED)}
              >
                <span className="text-text-muted">Unassigned</span>
              </CheckRow>
            </>
          )}
        </Menu>
      )}

      {labels.length > 0 && (
        <Menu
          label="Filter by label"
          align="left"
          trigger={
            <>
              Labels
              <Count n={filter.labels.length} />
            </>
          }
        >
          {() => (
            <>
              {labels.map((l) => (
                <CheckRow
                  key={l.id}
                  checked={filter.labels.includes(l.id)}
                  onSelect={() => toggle("labels", l.id)}
                >
                  <LabelChip label={l} size="sm" />
                </CheckRow>
              ))}
            </>
          )}
        </Menu>
      )}

      <Menu
        label="Filter by priority"
        align="left"
        trigger={
          <>
            Priority
            <Count n={filter.priorities.length} />
          </>
        }
      >
        {() => (
          <>
            {PRIORITIES.map((level) => (
              <CheckRow
                key={level}
                checked={filter.priorities.includes(level)}
                onSelect={() => togglePriority(level)}
              >
                <PriorityIcon priority={level} />
                <span>{level}</span>
              </CheckRow>
            ))}
          </>
        )}
      </Menu>

      <Menu
        label="Filter by due date"
        align="left"
        trigger={DUE_WINDOWS.find((w) => w.value === filter.due)?.label ?? "Any due date"}
      >
        {(close) => (
          <>
            {/* One window at a time, so these are radios rather than
                checkboxes. "Overdue" and "this week" as separate checkboxes
                would let somebody pick both and get exactly "this week",
                which reads as a control that ignored them. */}
            {DUE_WINDOWS.map((w) => (
              <CheckRow
                key={w.value}
                radio
                checked={filter.due === w.value}
                onSelect={() => {
                  onChange({ ...filter, due: w.value });
                  close();
                }}
              >
                <span>{w.label}</span>
              </CheckRow>
            ))}
          </>
        )}
      </Menu>

      <button
        type="button"
        onClick={() => onChange({ ...filter, recent: !filter.recent })}
        aria-pressed={filter.recent}
        className={`h-7 px-2.5 rounded-md border text-[12px] font-medium transition-colors cursor-pointer ${
          filter.recent
            ? "bg-accent border-accent text-accent-fg"
            : "bg-surface-2 border-border text-text-muted hover:text-text hover:border-border-2"
        }`}
      >
        Recently updated
      </button>

      <div className="flex-1" />

      {active && (
        <>
          {/* Said out loud, because a filtered board and a nearly empty one look
              identical — and the second is the more alarming reading (S2.3). */}
          <span className="text-[12px] text-text-dim tabular-nums" role="status">
            {matches} of {total}
          </span>
          {/* --danger, not a neutral link. Clearing a filter is the one control
              here that discards what you set up, and the design gives it the
              only warm colour in the row so it reads as an undo rather than
              another way to narrow things. */}
          <button
            type="button"
            onClick={onClear}
            className="text-[10.5px] uppercase tracking-[0.09em] text-danger hover:opacity-70 transition-opacity cursor-pointer"
          >
            Clear
          </button>
          <div className="w-px h-[18px] bg-border" aria-hidden="true" />
        </>
      )}

      {/* How the board is grouped, at the end of the row it belongs to. Not in
          the header: the header says which board you are on and never changes,
          this changes what you are looking at — the same reasoning that put the
          filters here rather than up there. */}
      <div className="flex gap-[3px]" role="group" aria-label="Group the board by">
        {LANE_VIEWS.map((option) => {
          const selected = option.id === view;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onViewChange(option.id)}
              aria-pressed={selected}
              className={
                selected
                  ? "px-2.5 py-1 rounded-md text-[12px] font-medium bg-surface-2 text-text cursor-pointer"
                  : "px-2.5 py-1 rounded-md text-[12px] text-text-dim hover:text-text transition-colors cursor-pointer"
              }
            >
              {option.name}
            </button>
          );
        })}
      </div>

      {/* Every active criterion, named and removable where it is showing its
          effect. Without this the only record of what you filtered by is inside
          the menus you set it from. */}
      {active && (
        <div className="basis-full flex items-center gap-1.5 flex-wrap pt-1.5">
          {filter.text.trim() && (
            <Chip onRemove={() => onChange({ ...filter, text: "" })} label={`Search: ${filter.text}`}>
              <span className="text-text-dim">Search</span>
              <span className="truncate max-w-[160px]">{filter.text}</span>
            </Chip>
          )}

          {filter.assignees.map((id) => (
            <Chip key={id} onRemove={() => toggle("assignees", id)} label={nameOf(id)}>
              {id !== UNASSIGNED && <Avatar name={nameOf(id)} size="sm" />}
              <span className="truncate max-w-[140px]">{nameOf(id)}</span>
            </Chip>
          ))}

          {filter.labels.map((id) => {
            const label = labelOf(id);
            return (
              <Chip key={id} onRemove={() => toggle("labels", id)} label={label?.name ?? "Label"}>
                {label ? <LabelChip label={label} size="sm" /> : <span>Label</span>}
              </Chip>
            );
          })}

          {filter.priorities.map((level) => (
            <Chip key={level} onRemove={() => togglePriority(level)} label={level}>
              <PriorityIcon priority={level} />
              <span>{level}</span>
            </Chip>
          ))}

          {filter.due !== "any" && (
            <Chip
              onRemove={() => onChange({ ...filter, due: "any" })}
              label={DUE_WINDOWS.find((w) => w.value === filter.due)?.label ?? "Due date"}
            >
              <span>{DUE_WINDOWS.find((w) => w.value === filter.due)?.label}</span>
            </Chip>
          )}

          {filter.recent && (
            <Chip onRemove={() => onChange({ ...filter, recent: false })} label="Recently updated">
              <span>Recently updated</span>
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

/** The number of choices behind a trigger, so the state is on the surface. */
function Count({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="min-w-4 h-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] font-semibold flex items-center justify-center tabular-nums">
      {n}
    </span>
  );
}

/**
 * A menu row that stays open when picked.
 *
 * Its own checkbox rather than a highlight, because the menu is open across
 * several picks and each row has to say its own state without depending on
 * which one you touched last.
 */
function CheckRow({
  checked,
  radio = false,
  onSelect,
  children,
}: {
  checked: boolean;
  /** One-of-many rather than any-of-many; announced and drawn as a radio. */
  radio?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onSelect}
      className="w-full flex items-center gap-2 text-left text-[13px] px-3 py-1.5 hover:bg-surface-2 transition-colors cursor-pointer"
    >
      <span
        aria-hidden="true"
        className={`w-3.5 h-3.5 border flex items-center justify-center shrink-0 ${
          radio ? "rounded-full" : "rounded-[3px]"
        } ${checked ? "bg-accent border-accent text-accent-fg" : "border-border"}`}
      >
        {checked &&
          (radio ? (
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
          ) : (
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6.2l2.2 2.2 4.8-4.8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ))}
      </span>
      {children}
    </button>
  );
}

function Chip({
  label,
  onRemove,
  children,
}: {
  /** What the remove button announces, since the chip's content may be an avatar. */
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-1 rounded-full bg-surface-2 border border-border text-[11px] text-text">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${label}`}
        className="w-4 h-4 flex items-center justify-center rounded-full text-text-dim hover:text-text hover:bg-surface transition-colors cursor-pointer shrink-0"
      >
        <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}
