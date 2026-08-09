// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPanel } from "@/components/board/ActivityPanel";
import { api, type ActivityResponse } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FEED: ActivityResponse = {
  entries: [
    {
      seq: 7,
      opType: "card.create",
      actorId: "me",
      actorName: "Yash P.",
      summary: "added “Write the docs”",
      createdAt: new Date().toISOString(),
      undone: false,
      canUndo: true,
    },
    {
      seq: 6,
      opType: "card.delete",
      actorId: "them",
      actorName: "Sara R.",
      summary: "deleted “Old idea”",
      createdAt: new Date().toISOString(),
      undone: true,
      canUndo: false,
    },
  ],
  undoableSeq: 7,
};

function renderPanel(feed: ActivityResponse | Error = FEED, canEdit = true) {
  const getSpy = vi.spyOn(api, "get").mockImplementation(async () => {
    if (feed instanceof Error) throw feed;
    return feed as never;
  });
  const postSpy = vi.spyOn(api, "post").mockResolvedValue(undefined as never);
  const onUndone = vi.fn();
  const onClose = vi.fn();

  render(
    <ActivityPanel
      boardId="board-1"
      boardSeq={7}
      canEdit={canEdit}
      getToken={async () => "token"}
      onClose={onClose}
      onUndone={onUndone}
    />
  );

  return { getSpy, postSpy, onUndone, onClose };
}

describe("ActivityPanel", () => {
  it("lists who did what, newest first", async () => {
    renderPanel();

    expect(await screen.findByText(/Write the docs/)).toBeTruthy();
    expect(screen.getByText("Yash P.")).toBeTruthy();
    expect(screen.getByText("Sara R.")).toBeTruthy();
  });

  it("marks an undone entry in words, not only with a strikethrough", async () => {
    renderPanel();

    // Struck-through text reads identically to a screen reader, so the state
    // has to be said as well as shown.
    expect(await screen.findByText(/· undone/)).toBeTruthy();
  });

  it("offers undo when there is something of yours to undo", async () => {
    const { postSpy, onUndone } = renderPanel();
    const user = userEvent.setup();

    const button = await screen.findByRole("button", { name: "Undo" });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await user.click(button);

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith("/boards/board-1/undo", "token", {}));
    expect(onUndone).toHaveBeenCalled();
  });

  it("disables undo when the server says there is nothing", async () => {
    renderPanel({ ...FEED, undoableSeq: null });

    const button = await screen.findByRole("button", { name: "Undo" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Nothing of yours left to undo.")).toBeTruthy();
  });

  it("hides the undo control entirely from a viewer (S8.1)", async () => {
    renderPanel(FEED, false);

    await screen.findByText(/Write the docs/);
    // Removed, not disabled: a viewer's inability to undo is permanent for the
    // session, not a transient state that might clear.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says what happened when the feed cannot be loaded (S3.6)", async () => {
    renderPanel(new TypeError("network"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");
  });

  it("explains an empty feed rather than showing a blank panel (S2.3)", async () => {
    renderPanel({ entries: [], undoableSeq: null });

    expect(await screen.findByText(/Nothing has happened on this board yet/)).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPanel();
    const user = userEvent.setup();

    await screen.findByText(/Write the docs/);
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
