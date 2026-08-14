// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardFilterBar } from "@/components/board/BoardFilterBar";
import { EMPTY_FILTER, UNASSIGNED } from "@/lib/boardFilter";
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
      view="status"
      onViewChange={() => {}}
      {...overrides}
    />
  );
  return { onChange, onClear };
}

const open = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name }));

describe("BoardFilterBar — controls are named", () => {
  it("labels every dropdown, rather than leaving a bare ⋯", () => {
    // The first version reused the actions menu, whose trigger is three dots.
    // A ⋯ beside a search box says nothing at all about labels.
    mount();

    expect(screen.getByRole("button", { name: "Filter by assignee" }).textContent).toContain(
      "People"
    );
    expect(screen.getByRole("button", { name: "Filter by label" }).textContent).toContain("Labels");
    expect(screen.getByRole("button", { name: "Filter by priority" }).textContent).toContain(
      "Priority"
    );
  });

  it("counts the choices behind each dropdown, so the state is on the surface", () => {
    mount({ filter: { ...EMPTY_FILTER, assignees: ["u-1"], priorities: ["High", "Highest"] } });

    expect(screen.getByRole("button", { name: "Filter by assignee" }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: "Filter by priority" }).textContent).toContain("2");
  });

  it("shows the chosen window on the due trigger instead of a count", () => {
    // One window at a time, so a count would only ever say "1".
    mount({ filter: { ...EMPTY_FILTER, due: "overdue" } });

    expect(screen.getByRole("button", { name: "Filter by due date" }).textContent).toContain(
      "Overdue"
    );
  });
});

describe("BoardFilterBar — search", () => {
  it("filters as you type, with no submit", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await user.type(screen.getByLabelText("Search cards"), "a");

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, text: "a" });
  });

  it("offers a clear button only once there is something to clear", async () => {
    const user = userEvent.setup();
    cleanup();
    mount();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    cleanup();
    const { onChange } = mount({ filter: { ...EMPTY_FILTER, text: "auth" } });
    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, text: "" });
  });

  it("focuses on / from anywhere on the board", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("/");

    expect(document.activeElement).toBe(screen.getByLabelText("Search cards"));
  });

  it("leaves / alone while someone is typing", async () => {
    // Otherwise it swallows the character mid-sentence in a card title, which
    // is exactly how this shortcut usually goes wrong.
    const user = userEvent.setup();
    mount({ filter: { ...EMPTY_FILTER, text: "x" } });

    const field = screen.getByLabelText("Search cards") as HTMLInputElement;
    field.blur();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();

    await user.keyboard("/");
    expect(document.activeElement).toBe(outside);

    outside.remove();
  });
});

describe("BoardFilterBar — people", () => {
  it("puts you first", async () => {
    // Filtering to yourself is the common case — Jira ships it as a named quick
    // filter. It is the first row here instead, so only one control holds it.
    const user = userEvent.setup();
    mount();

    await open(user, "Filter by assignee");
    const rows = screen.getAllByRole("menuitemcheckbox");
    expect(rows[0].textContent).toContain("You");
  });

  it("offers Unassigned, which nothing could express before", async () => {
    // An empty selection means "everyone", so unassigned work — the work most
    // likely to need picking up — was unfindable.
    const user = userEvent.setup();
    const { onChange } = mount();

    await open(user, "Filter by assignee");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Unassigned" }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, assignees: [UNASSIGNED] });
  });

  it("toggles a person off again", async () => {
    const user = userEvent.setup();
    const { onChange } = mount({ filter: { ...EMPTY_FILTER, assignees: ["u-1"] } });

    await open(user, "Filter by assignee");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Sara R./ }));

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, assignees: [] });
  });

  it("stays open across several picks, each row saying its own state", async () => {
    const user = userEvent.setup();
    mount({ filter: { ...EMPTY_FILTER, assignees: ["u-1"] } });

    await open(user, "Filter by assignee");

    expect(
      screen.getByRole("menuitemcheckbox", { name: /Sara R./ }).getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: /You/ }).getAttribute("aria-checked")).toBe(
      "false"
    );
  });
});

describe("BoardFilterBar — priority and due", () => {
  it("selects a level", async () => {
    const user = userEvent.setup();
    const { onChange } = mount();

    await open(user, "Filter by priority");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Highest/ }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, priorities: ["Highest"] });
  });

  it("makes due windows radios, because they nest rather than stack", async () => {
    // "Overdue" and "this week" as checkboxes would let somebody pick both and
    // get exactly "this week", which reads as a control that ignored them.
    const user = userEvent.setup();
    const { onChange } = mount();

    await open(user, "Filter by due date");
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows).toHaveLength(5);

    await user.click(screen.getByRole("menuitemradio", { name: "Due this week" }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, due: "week" });
  });

  it("closes after a due window, since there is nothing more to pick", async () => {
    const user = userEvent.setup();
    mount();

    await open(user, "Filter by due date");
    await user.click(screen.getByRole("menuitemradio", { name: "Overdue" }));

    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });
});

describe("BoardFilterBar — what is on", () => {
  it("says nothing until something is filtering", () => {
    mount();

    expect(screen.queryByText("5 of 12")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
  });

  it("names every active criterion as a removable chip", async () => {
    // A filter you cannot see is a filter you forget you applied, and then the
    // board looks like it has lost half its cards.
    const user = userEvent.setup();
    const { onChange } = mount({
      filter: {
        text: "auth",
        assignees: ["u-1"],
        labels: ["l-1"],
        priorities: ["High"],
        due: "overdue",
        recent: true,
      },
    });

    expect(screen.getByRole("button", { name: "Remove filter Sara R." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter Bug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter High" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter Overdue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter Recently updated" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Remove filter High" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ priorities: [] }));
  });

  it("counts what survived, because a filtered board and an empty one look alike", () => {
    mount({ filter: { ...EMPTY_FILTER, recent: true } });

    expect(screen.getByRole("status").textContent).toBe("5 of 12");
  });

  it("clears everything at once", async () => {
    const user = userEvent.setup();
    const { onClear } = mount({ filter: { ...EMPTY_FILTER, text: "auth" } });

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalled();
  });

  it("drops a control the board cannot use", () => {
    // An empty label menu is a control that does nothing.
    mount({ labels: [] });

    expect(screen.queryByRole("button", { name: "Filter by label" })).toBeNull();
  });
});
