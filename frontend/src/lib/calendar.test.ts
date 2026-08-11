import { describe, expect, it } from "vitest";
import {
  addDays,
  describeDay,
  monthGrid,
  parseValue,
  shiftMonth,
  todayValue,
  WEEKDAY_LABELS,
} from "@/lib/calendar";

describe("todayValue", () => {
  it("reads the day in UTC, not the viewer's zone", () => {
    // 00:30 UTC on the 11th is still the 10th in New York. Using the local day
    // here is exactly how clicking a date saves the one before it.
    expect(todayValue(Date.UTC(2026, 7, 11, 0, 30))).toBe("2026-08-11");
    expect(todayValue(Date.UTC(2026, 7, 11, 23, 45))).toBe("2026-08-11");
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("crosses a year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("goes backwards", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows 2028 is a leap year", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("adds a week", () => {
    expect(addDays("2026-08-11", 7)).toBe("2026-08-18");
  });

  it("leaves an unparseable value alone rather than inventing one", () => {
    expect(addDays("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("parseValue", () => {
  it("accepts a well-formed day", () => {
    expect(parseValue("2026-08-20")).toEqual({ year: 2026, month: 7, dayOfMonth: 20 });
  });

  it("rejects a day that does not exist", () => {
    // Date.UTC would roll this into March and the picker would silently move.
    expect(parseValue("2026-02-30")).toBeNull();
  });

  it("rejects the wrong shape", () => {
    expect(parseValue("2026-8-20")).toBeNull();
    expect(parseValue("20/08/2026")).toBeNull();
    expect(parseValue("")).toBeNull();
  });
});

describe("monthGrid", () => {
  it("always returns six rows of seven", () => {
    // A grid that changes height makes the popover jump under the pointer, and
    // the day beneath the cursor changes without the cursor moving.
    for (const month of [0, 1, 4, 8, 11]) {
      const grid = monthGrid(2026, month);
      expect(grid.weeks).toHaveLength(6);
      grid.weeks.forEach((w) => expect(w).toHaveLength(7));
    }
  });

  it("starts the week on Monday", () => {
    // 1 August 2026 is a Saturday, so the row holding it starts on 27 July.
    const grid = monthGrid(2026, 7);
    expect(grid.weeks[0][0].value).toBe("2026-07-27");
    expect(WEEKDAY_LABELS[0]).toBe("Mon");
  });

  it("marks borrowed days as outside the month", () => {
    const grid = monthGrid(2026, 7);
    expect(grid.weeks[0][0].inMonth).toBe(false);
    expect(grid.weeks[0][5].value).toBe("2026-08-01");
    expect(grid.weeks[0][5].inMonth).toBe(true);
  });

  it("runs continuously with no gaps or repeats", () => {
    const days = monthGrid(2026, 1).weeks.flat().map((d) => d.value);
    expect(new Set(days).size).toBe(42);
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBe(addDays(days[i - 1], 1));
    }
  });

  it("handles a February that starts on a Monday", () => {
    // 1 Feb 2027 is a Monday: no leading days at all, which is the case an
    // off-by-one in the Sunday-to-Monday rotation would break.
    const grid = monthGrid(2027, 1);
    expect(grid.weeks[0][0].value).toBe("2027-02-01");
    expect(grid.weeks[0][0].inMonth).toBe(true);
  });

  it("includes the leap day", () => {
    const days = monthGrid(2028, 1).weeks.flat().map((d) => d.value);
    expect(days).toContain("2028-02-29");
  });

  it("labels the month it was asked for, not the one the grid starts in", () => {
    // The grid for August 2026 starts on 27 July. Labelling from the first cell
    // would put "July" above a page of August.
    expect(monthGrid(2026, 7, "en-GB").label).toBe("August 2026");
  });
});

describe("shiftMonth", () => {
  it("steps forward across a year", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it("steps back across a year", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("stays put on zero", () => {
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });

  it("survives a jump of more than a year", () => {
    expect(shiftMonth(2026, 5, 14)).toEqual({ year: 2027, month: 7 });
  });
});

describe("describeDay", () => {
  it("names the weekday, for the day that has focus", () => {
    expect(describeDay("2026-08-20", "en-GB")).toBe("Thursday, 20 August 2026");
  });

  it("degrades rather than throwing", () => {
    expect(describeDay("nonsense")).toBe("nonsense");
  });
});
