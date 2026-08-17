// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateCardDialog } from "@/components/board/CreateCardDialog";
import { EMPTY_FILTER } from "@/lib/boardFilter";
import type { LabelResponse, MemberResponse } from "@/lib/api";

afterEach(cleanup);

const STATUSES = [
  { id: "col-todo", name: "To Do" },
  { id: "col-done", name: "Done" },
];

const MEMBERS: MemberResponse[] = [
  { userId: "u-1", displayName: "Sara R.", email: "sara@example.com", role: "Editor" , joinedAt: "2026-08-01T00:00:00.000Z" },
];

const LABELS: LabelResponse[] = [{ id: "l-1", name: "Bug", color: "red" }];

function mount(overrides: Partial<Parameters<typeof CreateCardDialog>[0]> = {}) {
  const onCreate = vi.fn(async () => {});
  const onCreateLabel = vi.fn(async () => {});
  const onDeleteLabel = vi.fn(async () => {});
  const onClearFilter = vi.fn();
  const onClose = vi.fn();
  render(
    <CreateCardDialog
      statuses={STATUSES}
      members={MEMBERS}
      labels={LABELS}
      defaultColumnId="col-todo"
      filter={EMPTY_FILTER}
      filterActive={false}
      onCreate={onCreate}
      onCreateLabel={onCreateLabel}
      onDeleteLabel={onDeleteLabel}
      onClearFilter={onClearFilter}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onCreate, onClearFilter, onClose };
}

const title = () => screen.getByLabelText("Title");
const create = () => screen.getByRole("button", { name: "Create" });

async function pick(user: ReturnType<typeof userEvent.setup>, field: string, option: string | RegExp) {
  await user.click(screen.getByRole("button", { name: field }));
  await user.click(screen.getByRole("option", { name: option }));
}

describe("CreateCardDialog", () => {
  it("refuses to create without a title", async () => {
    mount();

    expect((create() as HTMLButtonElement).disabled).toBe(true);
  });

  it("creates a bare card from a title alone", async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = mount();

    await user.type(title(), "Something");
    await user.click(create());

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("col-todo", {
        title: "Something",
        description: null,
        assigneeId: null,
        priority: null,
        dueAt: null,
        labelIds: [],
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("carries every field in one request, rather than creating then editing", async () => {
    // Two calls would be two operations and two broadcasts, and everyone else
    // would watch the card appear bare and then acquire its fields.
    const user = userEvent.setup();
    const { onCreate } = mount();

    await user.type(title(), "Complete");
    await user.type(screen.getByLabelText("Description"), "With everything");
    await pick(user, "Status", "Done");
    await pick(user, "Assignee", /Sara R./);
    await pick(user, "Priority", "High");
    // Behind the picker now, which both applies and creates.
    await user.click(screen.getByRole("button", { name: /label/i }));
    // `pressed` disambiguates the toggle from the delete control beside it,
    // which also carries the label name.
    await user.click(await screen.findByRole("button", { name: /Bug/, pressed: false }));

    await user.click(create());

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("col-done", {
        title: "Complete",
        description: "With everything",
        assigneeId: "u-1",
        priority: "High",
        dueAt: null,
        labelIds: ["l-1"],
      })
    );
  });

  it("trims the title, so a stray space is not a card called nothing", async () => {
    const user = userEvent.setup();
    const { onCreate } = mount();

    await user.type(title(), "  Padded  ");
    await user.click(create());

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("col-todo", expect.objectContaining({ title: "Padded" }))
    );
  });

  it("stays open and keeps what was typed when the create is rejected (S3.2)", async () => {
    const user = userEvent.setup();
    const { onClose } = mount({
      onCreate: vi.fn(async () => {
        throw new Error("Can't reach Tangram right now.");
      }),
    });

    await user.type(title(), "Worth keeping");
    await user.click(create());

    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach Tangram");
    expect(onClose).not.toHaveBeenCalled();
    expect((title() as HTMLInputElement).value).toBe("Worth keeping");
  });

  it("says nothing about filters when none is on", () => {
    mount();

    expect(screen.queryByText(/filter will hide this card/i)).toBeNull();
  });

  it("warns when the filter would hide the card the moment it is made", async () => {
    // Jira refuses inline creation on a filtered board rather than solve this.
    // Refusing reads as broken when you cannot see the cause, so this says what
    // will happen and offers the way out.
    const user = userEvent.setup();
    const { onClearFilter } = mount({
      filterActive: true,
      filter: { ...EMPTY_FILTER, labels: ["l-other"] },
    });

    await user.type(title(), "Hidden on arrival");

    expect(screen.getByRole("status").textContent).toContain("filter will hide this card");

    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onClearFilter).toHaveBeenCalled();
  });

  it("stops warning once the card would survive the filter", async () => {
    // Checked against the same `matchesFilter` the board uses, so the warning
    // cannot disagree with what actually happens.
    const user = userEvent.setup();
    mount({ filterActive: true, filter: { ...EMPTY_FILTER, labels: ["l-1"] } });

    await user.type(title(), "Tagged");
    expect(screen.getByRole("status")).toBeTruthy();

    // Behind the picker now, which both applies and creates.
    await user.click(screen.getByRole("button", { name: /label/i }));
    // `pressed` disambiguates the toggle from the delete control beside it,
    // which also carries the label name.
    await user.click(await screen.findByRole("button", { name: /Bug/, pressed: false }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("creates anyway if you keep the filter", async () => {
    const user = userEvent.setup();
    const { onCreate } = mount({
      filterActive: true,
      filter: { ...EMPTY_FILTER, labels: ["l-other"] },
    });

    await user.type(title(), "Made regardless");
    await user.click(create());

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("still offers labels on a board that has none yet", () => {
    // This used to assert the opposite. Hiding the row meant a brand new
    // board showed no labels, no hint they exist, and no way to make the
    // first one — and the moment you most want to invent a label is while
    // describing the card that needs it.
    mount({ labels: [] });
  
    expect(screen.getByText("Labels")).toBeTruthy();
    expect(screen.getByRole("button", { name: /label/i })).toBeTruthy();
  });
});
