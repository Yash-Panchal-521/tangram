import { describe, expect, it } from "vitest";
import {
  daysUntilDue,
  dueLabel,
  dueStatus,
  fromDateInputValue,
  toDateInputValue,
} from "@/lib/dueDate";

// Deliberately late in the UTC day: a naive local-time reading of the same
// instant lands on a different calendar day for anyone west of UTC, which is
// exactly how a card starts claiming it was due yesterday.
const NOW = Date.UTC(2026, 7, 20, 23, 30);
const day = (n: number) => new Date(Date.UTC(2026, 7, 20 + n)).toISOString();

describe("date input round trip", () => {
  it("survives a round trip through the input value", () => {
    const iso = fromDateInputValue("2026-08-20");
    expect(iso).toBe("2026-08-20T00:00:00.000Z");
    expect(toDateInputValue(iso)).toBe("2026-08-20");
  });

  it("treats an empty field as no date", () => {
    expect(fromDateInputValue("")).toBeNull();
    expect(toDateInputValue(null)).toBe("");
  });

  it("does not throw on an unparseable stored value", () => {
    expect(toDateInputValue("nonsense")).toBe("");
    expect(fromDateInputValue("nonsense")).toBeNull();
  });
});

describe("daysUntilDue", () => {
  it("counts whole days, not elapsed hours", () => {
    expect(daysUntilDue(day(0), NOW)).toBe(0);
    expect(daysUntilDue(day(1), NOW)).toBe(1);
    expect(daysUntilDue(day(-3), NOW)).toBe(-3);
  });
});

describe("dueStatus", () => {
  it("separates overdue, today, soon and later", () => {
    expect(dueStatus(day(-1), NOW)).toBe("overdue");
    expect(dueStatus(day(0), NOW)).toBe("today");
    expect(dueStatus(day(2), NOW)).toBe("soon");
    expect(dueStatus(day(3), NOW)).toBe("later");
  });
});

describe("dueLabel", () => {
  it("reads as a person would say it", () => {
    expect(dueLabel(day(-2), NOW)).toBe("2d late");
    expect(dueLabel(day(0), NOW)).toBe("Today");
    expect(dueLabel(day(1), NOW)).toBe("Tomorrow");
    expect(dueLabel(day(4), NOW)).toBe("in 4d");
  });

  it("falls back to a calendar date once the countdown stops helping", () => {
    // Formatted in UTC on purpose -- the label must match the day the date
    // input shows, not the viewer's local rendering of that instant.
    expect(dueLabel(day(20), NOW)).toMatch(/Sep/);
  });
});
