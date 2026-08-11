// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardDetailModal } from "@/components/board/detail/CardDetailModal";
import { formatDueDate } from "@/lib/dueDate";
import type { CardResponse, MemberResponse } from "@/lib/api";

afterEach(cleanup);

const CARD: CardResponse = {
  id: "card-1",
  columnId: "col-todo",
  title: "Ship the thing",
  description: "With tests",
  rank: "a0",
  dueAt: null,
  assigneeId: null,
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-04T14:30:00.000Z",
  priority: null,
  labels: [],
};

const STATUSES = [
  { id: "col-todo", name: "To Do" },
  { id: "col-doing", name: "In Progress" },
  { id: "col-done", name: "Done" },
];

const MEMBERS: MemberResponse[] = [
  { userId: "u-2", displayName: "Sara R.", email: "sara@example.com", role: "Editor" },
];

const LABELS = [
  { id: "l-1", name: "Bug", color: "red" as const },
  { id: "l-2", name: "Chore", color: "blue" as const },
];

function mount(overrides: Partial<Parameters<typeof CardDetailModal>[0]> = {}) {
  const onClose = vi.fn();
  const onCommit = vi.fn(async () => {});
  const onMove = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  const onCreateLabel = vi.fn(async () => {});
  const onDeleteLabel = vi.fn(async () => {});
  render(
    <CardDetailModal
      card={CARD}
      readOnly={false}
      members={MEMBERS}
      statuses={STATUSES}
      labels={LABELS}
      onClose={onClose}
      onCommit={onCommit}
      onMove={onMove}
      onDelete={onDelete}
      onCreateLabel={onCreateLabel}
      onDeleteLabel={onDeleteLabel}
      {...overrides}
    />
  );
  return { onClose, onCommit, onMove, onDelete, onCreateLabel, onDeleteLabel };
}

const summary = () => screen.getByRole("button", { name: /Summary/ });

describe("CardDetailModal — layout", () => {
  it("is a labelled modal dialog", () => {
    mount();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Named by the card, so a screen reader says which one opened.
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Ship the thing", { selector: "h2" })).toBeTruthy();
  });

  it("puts the description on the left and the context fields on the right", () => {
    mount();

    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    // Jira's split: what the work is, versus what you sort and filter it by.
    expect(screen.getByLabelText("Status")).toBeTruthy();
    expect(screen.getByLabelText("Assignee")).toBeTruthy();
    expect(screen.getByLabelText("Due")).toBeTruthy();
  });

  it("folds created and updated away until asked for", async () => {
    // Jira's "hide when empty" divider: never why anyone opened the card, so
    // they must not push the fields that matter off the top.
    const user = userEvent.setup();
    mount();

    expect(screen.queryByText("Created")).toBeNull();

    await user.click(screen.getByRole("button", { name: /More fields/ }));

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText(formatDueDate(CARD.createdAt))).toBeTruthy();
    expect(screen.getByText(formatDueDate(CARD.updatedAt))).toBeTruthy();
  });
});

describe("CardDetailModal — editing", () => {
  it("saves the summary on its own, with no Save button anywhere", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    // One Save button made four fields share one request's fate, and a failure
    // took all of them. There isn't one now.
    expect(screen.queryByRole("button", { name: /^Save$/ })).toBeNull();

    await user.click(summary());
    await user.keyboard(" now{Enter}");

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ title: "Ship the thing now" }));
  });

  it("saves the description behind explicit buttons", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(screen.getByRole("button", { name: /Description/ }));
    await user.keyboard(" and docs");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith({ description: "With tests and docs" })
    );
  });

  it("sends null for a description that was emptied", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(screen.getByRole("button", { name: /Description/ }));
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ description: null }));
  });

  it("assigns, and distinguishes clearing from leaving alone", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.selectOptions(screen.getByLabelText("Assignee"), "u-2");
    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith({ assigneeId: "u-2", clearAssignee: false })
    );

    await user.selectOptions(screen.getByLabelText("Assignee"), "");
    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith({ assigneeId: null, clearAssignee: true })
    );
  });

  it("keeps a departed assignee visible rather than silently clearing them", () => {
    // They are no longer in `members`, so a plain select would fall back to
    // "Unassigned" and the next save would quietly drop the assignment.
    mount({ card: { ...CARD, assigneeId: "gone" }, members: [] });

    const select = screen.getByLabelText("Assignee") as HTMLSelectElement;
    expect(select.value).toBe("gone");
    expect(screen.getByText("Someone who has left the workspace")).toBeTruthy();
  });
});

describe("CardDetailModal — priority", () => {
  it("offers the five levels plus None, most urgent first", () => {
    mount();

    const select = screen.getByLabelText("Priority") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "None",
      "Highest",
      "High",
      "Medium",
      "Low",
      "Lowest",
    ]);
  });

  it("starts at None rather than a level nobody chose", () => {
    // Jira defaults to Medium. A priority on every card is a priority on
    // nothing — the field only informs when some cards go without.
    mount();
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("");
  });

  it("sets a level", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.selectOptions(screen.getByLabelText("Priority"), "High");

    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith({ priority: "High", clearPriority: false })
    );
  });

  it("clears back to None with the flag, not a bare null", async () => {
    // Same reason clearDueAt exists: JSON cannot tell "absent" from "null", so
    // without the flag an edit would leave the priority alone instead.
    const user = userEvent.setup();
    const { onCommit } = mount({ card: { ...CARD, priority: "High" } });

    await user.selectOptions(screen.getByLabelText("Priority"), "");

    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith({ priority: null, clearPriority: true })
    );
  });

  it("shows the icon beside the control once a level is set", () => {
    mount({ card: { ...CARD, priority: "Highest" } });

    expect(screen.getByRole("img", { name: "Highest priority" })).toBeTruthy();
  });

  it("is text with no control for a viewer (S8.1)", () => {
    mount({ readOnly: true, card: { ...CARD, priority: "Medium" } });

    expect(screen.queryByLabelText("Priority")).toBeNull();
    expect(screen.getByText("Medium")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Medium priority" })).toBeTruthy();
  });

  it("reads None for a viewer when nothing is set", () => {
    mount({ readOnly: true });

    // Labels reads "None" too, so scope to the row rather than the document.
    const row = screen.getByText("Priority").closest("div")!;
    expect(within(row).getByText("None")).toBeTruthy();
  });
});

describe("CardDetailModal — labels", () => {
  it("shows the card's labels as named chips, not colour alone", () => {
    // Seven hues at chip size are not reliably distinguishable, and two people
    // can pick colours that read identically to someone who cannot separate
    // them. The name is the signal; the colour is a second one on top.
    mount({ card: { ...CARD, labels: [LABELS[0]] } });

    expect(screen.getByText("Bug")).toBeTruthy();
  });

  it("applies a label as the whole set, not an add instruction", async () => {
    // Set semantics all the way through: the card's labels are a field of the
    // card, which is why this rides the ordinary card update.
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));
    await user.click(screen.getByRole("button", { name: "Bug" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ labelIds: ["l-1"] }));
  });

  it("removes one by sending the set without it", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ card: { ...CARD, labels: [LABELS[0], LABELS[1]] } });

    await user.click(screen.getByRole("button", { name: "Remove Bug" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ labelIds: ["l-2"] }));
  });

  it("creates a label from inside the picker", async () => {
    // A label is nearly always invented at the moment someone wants to apply
    // it. Sending them to a settings screen first is how labels end up unused.
    const user = userEvent.setup();
    const { onCreateLabel } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));
    await user.type(screen.getByLabelText("New label name"), "Blocked");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onCreateLabel).toHaveBeenCalledWith("Blocked", "grey"));
  });

  it("creates with the colour that was picked", async () => {
    const user = userEvent.setup();
    const { onCreateLabel } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));
    await user.click(screen.getByRole("button", { name: "green" }));
    await user.type(screen.getByLabelText("New label name"), "Ready");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onCreateLabel).toHaveBeenCalledWith("Ready", "green"));
  });

  it("refuses to create a nameless label", async () => {
    const user = userEvent.setup();
    const { onCreateLabel } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));

    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCreateLabel).not.toHaveBeenCalled();
  });

  it("deletes a label from the board, not just from the card", async () => {
    const user = userEvent.setup();
    const { onDeleteLabel } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));
    await user.click(screen.getByRole("button", { name: "Delete the label Bug" }));

    await waitFor(() => expect(onDeleteLabel).toHaveBeenCalledWith("l-1"));
  });

  it("names the next action when the board has no labels yet (S2.3)", async () => {
    const user = userEvent.setup();
    mount({ labels: [] });

    await user.click(screen.getByRole("button", { name: "Add a label" }));

    expect(screen.getByText(/Make the first one below/)).toBeTruthy();
  });

  it("closes the picker on Escape without closing the card (S5.3)", async () => {
    // Both the picker and the card listen on `document`, so an unpaused card
    // takes the same Escape and closes underneath its own popover.
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.click(screen.getByRole("button", { name: "Add a label" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Labels" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the calendar on Escape without closing the card either", async () => {
    // Same stacking problem, and the date picker already publishes the flag
    // that solves it — it just was not being listened to.
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.click(screen.getByLabelText("Due"));
    expect(screen.getByRole("dialog", { name: "Choose a date" })).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Choose a date" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives a viewer chips with no picker and no remove (S8.1)", () => {
    mount({ readOnly: true, card: { ...CARD, labels: [LABELS[0]] } });

    expect(screen.getByText("Bug")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a label" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});

describe("CardDetailModal — status", () => {
  it("lists the board's columns and moves the card", async () => {
    // Jira's status dropdown, mapped onto columns — which is what status
    // actually is here, so it needs no schema at all.
    const user = userEvent.setup();
    const { onMove } = mount();

    const status = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(status.value).toBe("col-todo");
    expect([...status.options].map((o) => o.textContent)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);

    await user.selectOptions(status, "col-done");
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("col-done"));
  });

  it("says why a move failed rather than leaving the control looking stuck", async () => {
    const user = userEvent.setup();
    mount({
      onMove: vi.fn(async () => {
        throw new Error("Couldn't move that card — check your connection.");
      }),
    });

    await user.selectOptions(screen.getByLabelText("Status"), "col-done");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("check your connection");
  });
});

describe("CardDetailModal — failure lands on the field", () => {
  it("reverts the summary and explains next to it (S3.2, S3.6)", async () => {
    // The old panel closed on a failed save and put the message on the board
    // behind it, so a rejected save looked exactly like a successful one.
    const user = userEvent.setup();
    const { onClose } = mount({
      onCommit: vi.fn(async () => {
        throw new Error("Couldn't save that card — check your connection.");
      }),
    });

    await user.click(summary());
    await user.keyboard("!{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("check your connection");
    expect(summary().textContent).toBe("Ship the thing");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CardDetailModal — closing", () => {
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the overlay behind it", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    // The scrim is aria-hidden, so it has no role to query by — but it is the
    // click target a person actually uses to dismiss a modal.
    const overlay = document.querySelector('[aria-hidden="true"].fixed') as HTMLElement;
    expect(overlay).toBeTruthy();
    await user.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when Escape cancels an inline edit instead", async () => {
    // The editor contains the keystroke, so the modal behind it stays put and
    // the edit is merely reverted.
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.click(summary());
    await user.keyboard(" scrapped{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(summary().textContent).toBe("Ship the thing");
  });
});

describe("CardDetailModal — deleting", () => {
  it("confirms first, naming the card (S4.2, S4.3)", async () => {
    const user = userEvent.setup();
    const { onDelete } = mount();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText('Delete "Ship the thing"?')).toBeTruthy();
    expect(screen.getByText(/can't be undone/)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete card" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("does not let one Escape dismiss both the confirmation and the modal", async () => {
    // The regression the `paused` flag exists for: both listen on document.
    const user = userEvent.setup();
    const { onClose, onDelete } = mount();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.keyboard("{Escape}");

    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The confirmation went; the modal underneath it did not.
    expect(screen.queryByText('Delete "Ship the thing"?')).toBeNull();
    expect(summary()).toBeTruthy();
  });
});

describe("CardDetailModal — read-only", () => {
  it("removes every edit affordance rather than disabling them (S8.1)", () => {
    mount({ readOnly: true });

    // For a viewer the truth is "not you", not "not right now".
    expect(screen.queryByRole("button", { name: /Summary/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Description/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByLabelText("Assignee")).toBeNull();

    // The values are still there, as text.
    expect(screen.getByText("Ship the thing", { selector: "h2" })).toBeTruthy();
    expect(screen.getByText("With tests")).toBeTruthy();
    expect(screen.getByText("To Do")).toBeTruthy();
  });

  it("says it is view-only, so the missing controls are explained (S8.2)", () => {
    mount({ readOnly: true });
    expect(screen.getByText("View only")).toBeTruthy();
  });

  it("still closes", async () => {
    const user = userEvent.setup();
    const { onClose } = mount({ readOnly: true });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CardDetailModal — live updates", () => {
  it("shows an edit that arrived from someone else", async () => {
    // The bug this whole rework fixes: the old panel held a snapshot, so a
    // broadcast updated the board behind it and never the panel itself.
    const { rerender } = render(
      <CardDetailModal
        card={CARD}
        readOnly={false}
        members={MEMBERS}
        statuses={STATUSES}
        labels={LABELS}
        onClose={vi.fn()}
        onCommit={vi.fn(async () => {})}
        onMove={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
        onCreateLabel={vi.fn(async () => {})}
        onDeleteLabel={vi.fn(async () => {})}
      />
    );

    rerender(
      <CardDetailModal
        card={{ ...CARD, title: "Renamed by Sara", columnId: "col-done" }}
        readOnly={false}
        members={MEMBERS}
        statuses={STATUSES}
        labels={LABELS}
        onClose={vi.fn()}
        onCommit={vi.fn(async () => {})}
        onMove={vi.fn(async () => {})}
        onDelete={vi.fn(async () => {})}
        onCreateLabel={vi.fn(async () => {})}
        onDeleteLabel={vi.fn(async () => {})}
      />
    );

    expect(summary().textContent).toBe("Renamed by Sara");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("col-done");
  });
});
