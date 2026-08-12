import { describe, expect, it } from "vitest";
import {
  applyFilterToUrl,
  EMPTY_FILTER,
  UNASSIGNED,
  filterBoard,
  isFilterActive,
  matchesFilter,
  parseFilter,
} from "@/lib/boardFilter";
import type { BoardDetailResponse, CardResponse } from "@/lib/api";

const NOW = Date.parse("2026-08-12T12:00:00.000Z");

function card(overrides: Partial<CardResponse> = {}): CardResponse {
  return {
    id: "c-1",
    columnId: "col-1",
    title: "Ship the thing",
    description: "With tests",
    rank: "a0",
    dueAt: null,
    assigneeId: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-12T11:00:00.000Z",
    priority: null,
    labels: [],
    commentCount: 0,
    ...overrides,
  };
}

describe("matchesFilter — text", () => {
  it("searches the description as well as the title", () => {
    // Half of what makes a card findable is written in the description rather
    // than a summary somebody kept short.
    expect(matchesFilter(card(), { ...EMPTY_FILTER, text: "tests" }, NOW)).toBe(true);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesFilter(card(), { ...EMPTY_FILTER, text: "  SHIP " }, NOW)).toBe(true);
  });

  it("copes with a card that has no description", () => {
    const c = card({ description: null });
    expect(matchesFilter(c, { ...EMPTY_FILTER, text: "ship" }, NOW)).toBe(true);
    expect(matchesFilter(c, { ...EMPTY_FILTER, text: "null" }, NOW)).toBe(false);
  });
});

describe("matchesFilter — assignee", () => {
  it("keeps only the selected people", () => {
    expect(matchesFilter(card({ assigneeId: "u-1" }), { ...EMPTY_FILTER, assignees: ["u-1"] }, NOW)).toBe(true);
    expect(matchesFilter(card({ assigneeId: "u-2" }), { ...EMPTY_FILTER, assignees: ["u-1"] }, NOW)).toBe(false);
  });

  it("hides unassigned cards once anyone is selected", () => {
    // Selecting people is a question about people. "Nobody" is not one of them
    // — it is what the empty selection already means.
    expect(matchesFilter(card({ assigneeId: null }), { ...EMPTY_FILTER, assignees: ["u-1"] }, NOW)).toBe(false);
  });
});

describe("matchesFilter — labels", () => {
  const bug = { id: "l-1", name: "Bug", color: "red" as const };
  const chore = { id: "l-2", name: "Chore", color: "blue" as const };

  it("matches any selected label, not all of them", () => {
    // Labels are tags, not facets. Requiring every selected label makes a
    // two-label selection almost always empty.
    const c = card({ labels: [bug] });
    expect(matchesFilter(c, { ...EMPTY_FILTER, labels: ["l-1", "l-2"] }, NOW)).toBe(true);
  });

  it("hides a card carrying none of them", () => {
    expect(matchesFilter(card({ labels: [chore] }), { ...EMPTY_FILTER, labels: ["l-1"] }, NOW)).toBe(false);
    expect(matchesFilter(card({ labels: [] }), { ...EMPTY_FILTER, labels: ["l-1"] }, NOW)).toBe(false);
  });
});

describe("matchesFilter — recency", () => {
  it("keeps a card updated inside the last day and drops one outside it", () => {
    expect(matchesFilter(card(), { ...EMPTY_FILTER, recent: true }, NOW)).toBe(true);

    const old = card({ updatedAt: "2026-08-10T11:00:00.000Z" });
    expect(matchesFilter(old, { ...EMPTY_FILTER, recent: true }, NOW)).toBe(false);
  });

  it("takes the clock as an argument rather than reading it", () => {
    // Otherwise the boundary is untestable and the result depends on when
    // React last re-rendered.
    const c = card({ updatedAt: "2026-08-12T11:00:00.000Z" });
    const dayLater = NOW + 24 * 60 * 60 * 1000;
    expect(matchesFilter(c, { ...EMPTY_FILTER, recent: true }, dayLater)).toBe(false);
  });
});

describe("matchesFilter — unassigned", () => {
  it("finds cards with nobody on them", () => {
    const f = { ...EMPTY_FILTER, assignees: [UNASSIGNED] };
    expect(matchesFilter(card({ assigneeId: null }), f, NOW)).toBe(true);
    expect(matchesFilter(card({ assigneeId: "u-1" }), f, NOW)).toBe(false);
  });

  it("composes with a person, because it is the same question", () => {
    // "Sara's or nobody's" is how you find work that is either hers or yours
    // to pick up.
    const f = { ...EMPTY_FILTER, assignees: ["u-1", UNASSIGNED] };
    expect(matchesFilter(card({ assigneeId: "u-1" }), f, NOW)).toBe(true);
    expect(matchesFilter(card({ assigneeId: null }), f, NOW)).toBe(true);
    expect(matchesFilter(card({ assigneeId: "u-2" }), f, NOW)).toBe(false);
  });
});

describe("matchesFilter — priority", () => {
  it("keeps the selected levels", () => {
    const f = { ...EMPTY_FILTER, priorities: ["High" as const] };
    expect(matchesFilter(card({ priority: "High" }), f, NOW)).toBe(true);
    expect(matchesFilter(card({ priority: "Low" }), f, NOW)).toBe(false);
  });

  it("hides cards with no priority once a level is chosen", () => {
    const f = { ...EMPTY_FILTER, priorities: ["High" as const] };
    expect(matchesFilter(card({ priority: null }), f, NOW)).toBe(false);
  });
});

describe("matchesFilter — due", () => {
  const overdue = card({ dueAt: "2026-08-10T00:00:00.000Z" });
  const today = card({ dueAt: "2026-08-12T00:00:00.000Z" });
  const soon = card({ dueAt: "2026-08-15T00:00:00.000Z" });
  const later = card({ dueAt: "2026-09-30T00:00:00.000Z" });
  const undated = card({ dueAt: null });

  it("nests rather than stacks", () => {
    // Somebody asking what is due this week is not asking to be shown only the
    // days after tomorrow, so the wider window contains the narrower ones.
    expect(matchesFilter(overdue, { ...EMPTY_FILTER, due: "overdue" }, NOW)).toBe(true);
    expect(matchesFilter(today, { ...EMPTY_FILTER, due: "overdue" }, NOW)).toBe(false);

    expect(matchesFilter(overdue, { ...EMPTY_FILTER, due: "today" }, NOW)).toBe(true);
    expect(matchesFilter(today, { ...EMPTY_FILTER, due: "today" }, NOW)).toBe(true);

    expect(matchesFilter(overdue, { ...EMPTY_FILTER, due: "week" }, NOW)).toBe(true);
    expect(matchesFilter(soon, { ...EMPTY_FILTER, due: "week" }, NOW)).toBe(true);
    expect(matchesFilter(later, { ...EMPTY_FILTER, due: "week" }, NOW)).toBe(false);
  });

  it("treats undated cards as their own window, never as a match for a date", () => {
    expect(matchesFilter(undated, { ...EMPTY_FILTER, due: "none" }, NOW)).toBe(true);
    expect(matchesFilter(undated, { ...EMPTY_FILTER, due: "overdue" }, NOW)).toBe(false);
    expect(matchesFilter(today, { ...EMPTY_FILTER, due: "none" }, NOW)).toBe(false);
  });

  it("lets everything through on any", () => {
    expect(matchesFilter(undated, { ...EMPTY_FILTER, due: "any" }, NOW)).toBe(true);
    expect(matchesFilter(later, { ...EMPTY_FILTER, due: "any" }, NOW)).toBe(true);
  });
});

describe("matchesFilter — combining", () => {
  it("requires every active criterion, not any of them", () => {
    const c = card({ assigneeId: "u-1" });
    const filter = { ...EMPTY_FILTER, text: "ship", assignees: ["u-2"] };

    // Text matches, assignee does not.
    expect(matchesFilter(c, filter, NOW)).toBe(false);
  });
});

describe("filterBoard", () => {
  const board: BoardDetailResponse = {
    id: "b-1",
    name: "Board",
    workspaceId: "w-1",
    role: "Owner",
    seq: 0,
    labels: [],
    columns: [
      { id: "col-1", name: "To Do", rank: "a0", cards: [card({ id: "c-1", title: "Alpha" })] },
      { id: "col-2", name: "Done", rank: "a1", cards: [card({ id: "c-2", title: "Beta" })] },
    ],
  };

  it("returns the board untouched when nothing is filtering", () => {
    // Identity, not a copy: an unfiltered board must not be a new object every
    // render, or everything downstream re-renders for nothing.
    expect(filterBoard(board, EMPTY_FILTER, NOW)).toBe(board);
  });

  it("keeps columns whose cards all disappear", () => {
    // A column is the board's structure, not its contents. Dropping it would
    // make a filter look like it deleted a stage of the workflow.
    const filtered = filterBoard(board, { ...EMPTY_FILTER, text: "alpha" }, NOW);

    expect(filtered.columns.map((c) => c.id)).toEqual(["col-1", "col-2"]);
    expect(filtered.columns[1].cards).toEqual([]);
  });

  it("does not mutate the board it was given", () => {
    filterBoard(board, { ...EMPTY_FILTER, text: "alpha" }, NOW);
    expect(board.columns[1].cards).toHaveLength(1);
  });
});

describe("isFilterActive", () => {
  it("ignores whitespace-only text", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: "   " })).toBe(false);
  });

  it("is true for any one criterion", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, recent: true })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, labels: ["l-1"] })).toBe(true);
  });
});

describe("URL round-trip", () => {
  it("survives a trip through the query string", () => {
    const filter = {
      ...EMPTY_FILTER,
      text: "auth bug",
      assignees: ["u-1", "u-2"],
      labels: ["l-9"],
      priorities: ["High" as const],
      due: "overdue" as const,
      recent: true,
    };
    const url = applyFilterToUrl(new URL("https://x.test/board/b-1"), filter);

    expect(parseFilter(url.search)).toEqual(filter);
  });

  it("deletes parameters rather than emptying them", () => {
    // `?q=&assignee=` says nothing, does not round-trip to what produced it,
    // and is what people copy and send each other.
    const url = applyFilterToUrl(new URL("https://x.test/b?q=old&assignee=u-1&recent=1"), EMPTY_FILTER);

    expect(url.search).toBe("");
  });

  it("leaves unrelated parameters alone", () => {
    // `?card=` shares this URL, and filtering must not close an open card.
    const url = applyFilterToUrl(new URL("https://x.test/b?card=c-1"), { ...EMPTY_FILTER, recent: true });

    expect(url.searchParams.get("card")).toBe("c-1");
    expect(url.searchParams.get("recent")).toBe("1");
  });

  it("ignores a priority that is not a level", () => {
    // Hand-edited URLs happen. An unknown level would silently match nothing
    // while the bar showed a filter nobody could remove.
    expect(parseFilter("?priority=High,Sideways").priorities).toEqual(["High"]);
  });

  it("falls back to any for an unknown due window", () => {
    expect(parseFilter("?due=eventually").due).toBe("any");
  });

  it("drops empty entries from a malformed list", () => {
    expect(parseFilter("?assignee=,u-1,,u-2,").assignees).toEqual(["u-1", "u-2"]);
  });

  it("reads a missing query string as no filter", () => {
    expect(parseFilter("")).toEqual(EMPTY_FILTER);
  });
});
