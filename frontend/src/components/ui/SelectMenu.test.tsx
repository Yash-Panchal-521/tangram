// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectMenu } from "@/components/ui/SelectMenu";

afterEach(cleanup);

const OPTIONS = [
  { value: "", label: "None", muted: true },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

function mount(overrides: Partial<Parameters<typeof SelectMenu>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <SelectMenu label="Priority" value="" options={OPTIONS} onChange={onChange} {...overrides} />
  );
  return { onChange };
}

const trigger = () => screen.getByRole("button", { name: "Priority" });

describe("SelectMenu", () => {
  it("reads as the current value when closed", () => {
    mount({ value: "high" });

    expect(trigger().textContent).toContain("High");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens a listbox whose options say which one is current", async () => {
    const user = userEvent.setup();
    mount({ value: "high" });

    await user.click(trigger());

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: "High" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: "Low" }).getAttribute("aria-selected")).toBe("false");
  });

  it("chooses on click and closes", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "Low" }));

    expect(onChange).toHaveBeenCalledWith("low");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not commit a value that is already set", async () => {
    // A field that fires on every pick sends a request for choosing what is
    // already chosen, and each one is a broadcast to everyone else's board.
    const user = userEvent.setup();
    const { onChange } = mount({ value: "high" });

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: "High" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens on an arrow key, as a native select does", async () => {
    const user = userEvent.setup();
    mount();

    trigger().focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("starts on the current value, so Down moves from where you are", async () => {
    const user = userEvent.setup();
    mount({ value: "high" });

    await user.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "High" }));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Low" }));
  });

  it("stops at the ends rather than wrapping, and Home and End reach them", async () => {
    const user = userEvent.setup();
    mount({ value: "" });

    await user.click(trigger());
    await user.keyboard("{ArrowUp}");
    // Already at the first option; it stays there rather than jumping to the last.
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "None" }));

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Low" }));

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "None" }));
  });

  it("chooses with Enter", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("closes on Escape without choosing, and hands focus back", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(trigger());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps an icon out of the accessible name", async () => {
    // Left exposed, a priority icon makes the option read "High priority High",
    // which is the duplication the card detail already avoids.
    const user = userEvent.setup();
    mount({
      options: [
        { value: "high", label: "High", icon: <svg role="img" aria-label="High priority" /> },
      ],
      value: "high",
    });

    await user.click(trigger());

    expect(screen.getByRole("option", { name: "High" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "High priority" })).toBeNull();
  });

  it("cannot be opened when disabled", async () => {
    const user = userEvent.setup();
    mount({ disabled: true });

    await user.click(trigger());

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
