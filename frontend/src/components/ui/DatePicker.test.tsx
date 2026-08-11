// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "@/components/ui/DatePicker";

// A Thursday, so the Monday-start grid has leading days from the previous month.
const NOW = Date.UTC(2026, 7, 20, 9, 0);

afterEach(cleanup);

function mount(value = "", extra: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <DatePicker
      value={value}
      onChange={onChange}
      onOpenChange={onOpenChange}
      now={NOW}
      locale="en-GB"
      {...extra}
    />
  );
  return { onChange, onOpenChange };
}

const trigger = () => screen.getByRole("button", { name: /No due date|August|July|September/ });

describe("DatePicker — the field", () => {
  it("says there is no date rather than showing an empty input", () => {
    // The native control offered "dd-mm-yyyy", which reads as a broken field
    // rather than as an absent value.
    mount();
    expect(screen.getByText("No due date")).toBeTruthy();
  });

  it("shows the date and how far away it is", () => {
    mount("2026-08-22");
    expect(screen.getByText("22 August 2026")).toBeTruthy();
    expect(screen.getByText("in 2d")).toBeTruthy();
  });

  it("opens and closes on the trigger", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = mount();

    await user.click(trigger());
    expect(screen.getByRole("dialog", { name: "Choose a date" })).toBeTruthy();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe("DatePicker — picking", () => {
  it("makes the common dates one click", async () => {
    // Most due dates are "today" or "tomorrow", which a bare grid makes three
    // interactions each.
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));

    expect(onChange).toHaveBeenCalledWith("2026-08-21");
  });

  it("counts a week forward, not five working days", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Next week" }));

    expect(onChange).toHaveBeenCalledWith("2026-08-27");
  });

  it("picks a day from the grid", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.click(screen.getByRole("gridcell", { name: /Tuesday, 25 August 2026/ }));

    expect(onChange).toHaveBeenCalledWith("2026-08-25");
  });

  it("closes once a day is chosen", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = mount();

    await user.click(trigger());
    await user.click(screen.getByRole("gridcell", { name: /25 August 2026/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("offers to clear only when there is something to clear (S8.1)", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    expect(screen.queryByRole("button", { name: /Clear due date/ })).toBeNull();
  });

  it("clears to an empty value, not to today", async () => {
    const user = userEvent.setup();
    const { onChange } = mount("2026-08-22");

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: /Clear due date/ }));

    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("DatePicker — the grid", () => {
  it("starts the week on Monday and lays out six rows", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    const rows = screen.getAllByRole("row");
    // One header row plus six weeks.
    expect(rows).toHaveLength(7);
    expect(within(rows[0]).getAllByRole("columnheader")[0].getAttribute("aria-label")).toBe("Mon");
  });

  it("keeps six rows across months, so the popover never resizes", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Next month" }));

    // A grid that changes height moves the day under the cursor without the
    // cursor moving.
    expect(screen.getAllByRole("row")).toHaveLength(7);
  });

  it("pages between months", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    expect(screen.getByText("August 2026")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("July 2026")).toBeTruthy();
  });

  it("marks today, and the selected day as selected", async () => {
    const user = userEvent.setup();
    mount("2026-08-22");

    await user.click(trigger());
    expect(
      screen.getByRole("gridcell", { name: /20 August 2026/ }).getAttribute("aria-current")
    ).toBe("date");
    expect(
      screen.getByRole("gridcell", { name: /22 August 2026/ }).getAttribute("aria-selected")
    ).toBe("true");
  });
});

describe("DatePicker — keyboard", () => {
  it("opens on the selected day, so the arrow keys start somewhere useful", async () => {
    const user = userEvent.setup();
    mount("2026-08-22");

    await user.click(trigger());
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/22 August 2026/);
  });

  it("opens on today when nothing is selected", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/20 August 2026/);
  });

  it("moves a day at a time and a week at a time", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/21 August/);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/28 August/);
  });

  it("carries focus into the next month rather than stopping at the edge", async () => {
    const user = userEvent.setup();
    mount("2026-08-31");

    await user.click(trigger());
    await user.keyboard("{ArrowRight}");

    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/1 September 2026/);
    expect(screen.getByText("September 2026")).toBeTruthy();
  });

  it("pages by month, clamping rather than skipping one", async () => {
    // From the 31st into a 30-day month. Rolling over would land in October and
    // silently skip September.
    const user = userEvent.setup();
    mount("2026-08-31");

    await user.click(trigger());
    await user.keyboard("{PageDown}");

    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/30 September 2026/);
  });

  it("jumps to the ends of the week", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    await user.keyboard("{Home}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/Monday, 17 August/);

    await user.keyboard("{End}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/Sunday, 23 August/);
  });

  it("selects the focused day with Enter", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.keyboard("{ArrowRight}{Enter}");

    expect(onChange).toHaveBeenCalledWith("2026-08-21");
  });

  it("keeps the whole grid to one tab stop", async () => {
    // 42 buttons in the tab order would make Tab useless for leaving the
    // calendar.
    const user = userEvent.setup();
    mount();

    await user.click(trigger());
    const cells = screen.getAllByRole("gridcell");
    expect(cells.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("closes on Escape without picking anything", async () => {
    const user = userEvent.setup();
    const { onChange, onOpenChange } = mount();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("hands focus back to the field it came from (S5.4)", async () => {
    const user = userEvent.setup();
    mount();

    const field = trigger();
    await user.click(field);
    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(field);
  });
});

describe("DatePicker — timezones", () => {
  it("picks the day that was clicked, west of UTC", async () => {
    // The bug this whole file guards: a grid built in local time turns a click
    // on the 25th into the 24th for anyone behind UTC.
    const user = userEvent.setup();
    const { onChange } = mount("", { now: Date.UTC(2026, 7, 20, 2, 30) });

    await user.click(trigger());
    await user.click(screen.getByRole("gridcell", { name: /25 August 2026/ }));

    expect(onChange).toHaveBeenCalledWith("2026-08-25");
  });

  it("calls the right day today, late in the UTC evening", async () => {
    const user = userEvent.setup();
    mount("", { now: Date.UTC(2026, 7, 20, 23, 45) });

    await user.click(trigger());
    expect(
      screen.getByRole("gridcell", { name: /20 August 2026/ }).getAttribute("aria-current")
    ).toBe("date");
  });
});
