// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardFilterBar } from "@/components/board/BoardFilterBar";
import { EMPTY_FILTER } from "@/lib/boardFilter";
import type { LabelResponse, MemberResponse } from "@/lib/api";

afterEach(cleanup);

const MEMBERS: MemberResponse[] = [
  { userId: "u-1", displayName: "Sara R.", email: "sara@example.com", role: "Editor" },
  { userId: "u-me", displayName: "You", email: "you@example.com", role: "Owner" },
];

const LABELS: LabelResponse[] = [
  { id: "l-1", name: "Bug", color: "red" },
  { id: "l-2", name: "Chore", color: "blue" },
];

function mount(overrides: Partial<Parameters<typeof BoardFilterBar>[0]> = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  render(
    <BoardFilterBar
      filter={EMPTY_FILTER}
      members={MEMBERS}
      labels={LABELS}
      currentUserId="u-me"
      matches={5}
      total={12}
      onChange={onChange}
      onClear={onClear}
      {...overrides}
    />
  );
  return { onChange, onClear };
}

describe("BoardFilterBar", () => {
  it("searches on typing, without a submit", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.type(screen.getByLabelText("Search cards"), "a");

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, text: "a" });
  });

  it("puts you first in the avatar row", () => {
    // Filtering to yourself is the common case — Jira ships it as a named quick
    // filter. It is one click on your own face here instead, so there is only
    // ever one control holding that state.
    mount();

    const avatars = screen.getAllByRole("button", { name: /Only cards assigned to/ });
    expect(avatars[0].getAttribute("aria-label")).toBe("Only cards assigned to You");
  });

  it("toggles a person on and back off", async () => {
    const user = userEvent.setup();
    const { onChange } = mount({ filter: { ...EMPTY_FILTER, assignees: ["u-1"] } });

    await user.click(screen.getByRole("button", { name: "Only cards assigned to Sara R." }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, assignees: [] });

    await user.click(screen.getByRole("button", { name: "Only cards assigned to You" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, assignees: ["u-1", "u-me"] });
  });

  it("says which people are selected without dimming the others", () => {
    // Dimming the unselected ones makes the row look disabled, and there is no
    // state here where these stop working.
    mount({ filter: { ...EMPTY_FILTER, assignees: ["u-1"] } });

    const sara = screen.getByRole("button", { name: "Only cards assigned to Sara R." });
    const you = screen.getByRole("button", { name: "Only cards assigned to You" });

    expect(sara.getAttribute("aria-pressed")).toBe("true");
    expect(you.getAttribute("aria-pressed")).toBe("false");
    expect(you.className).not.toContain("opacity");
  });

  it("keeps the label menu open across several picks", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(screen.getByRole("button", { name: "Filter by label" }));
    await user.click(screen.getByRole("menuitem", { name: /Bug/ }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, labels: ["l-1"] });
    // Still open: picking two labels should not cost two trips to the menu.
    expect(screen.getByRole("menuitem", { name: /Chore/ })).toBeTruthy();
  });

  it("toggles recency", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.click(screen.getByRole("button", { name: "Recently updated" }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, recent: true });
  });

  it("stays quiet until something is filtering", () => {
    mount();

    // No count and no Clear on an unfiltered board — both would be noise
    // describing a filter nobody applied.
    expect(screen.queryByText("5 of 12")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("says how much is hidden once it is", () => {
    // A filtered board and a nearly empty one look identical, and the second is
    // the more alarming reading.
    mount({ filter: { ...EMPTY_FILTER, recent: true } });

    expect(screen.getByRole("status").textContent).toBe("5 of 12");
  });

  it("clears everything at once", async () => {
    const user = userEvent.setup();
    const { onClear } = mount({ filter: { ...EMPTY_FILTER, text: "auth", labels: ["l-1"] } });

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClear).toHaveBeenCalled();
  });

  it("drops the label control on a board with no labels", () => {
    // Rather than offering an empty menu, which is a control that does nothing.
    mount({ labels: [] });

    expect(screen.queryByRole("button", { name: "Filter by label" })).toBeNull();
  });
});
