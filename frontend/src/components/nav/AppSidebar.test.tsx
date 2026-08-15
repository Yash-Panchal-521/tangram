// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/nav/AppSidebar";
import type { WorkspaceSummaryResponse } from "@/lib/api";

afterEach(cleanup);

function workspace(
  id: string,
  name: string,
  boards: { id: string; name: string; archived?: boolean }[]
): WorkspaceSummaryResponse {
  return {
    id,
    name,
    role: "Owner",
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      archived: b.archived ?? false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      columnCount: 3,
      cardCount: 9,
      overLimitColumns: 0,
      columns: [],
      activePeople: [],
    })),
  } as WorkspaceSummaryResponse;
}

const WORKSPACES = [
  workspace("w-1", "Ada's workspace", [
    { id: "b-1", name: "Roadmap" },
    { id: "b-2", name: "Bugs" },
    { id: "b-3", name: "Old things", archived: true },
  ]),
  workspace("w-2", "Client work", [{ id: "b-9", name: "Acme" }]),
];

function mount(overrides: Partial<Parameters<typeof AppSidebar>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <AppSidebar
      workspaces={WORKSPACES}
      currentWorkspaceId={null}
      currentBoardId="b-1"
      collapsed={false}
      onToggle={onToggle}
      {...overrides}
    />
  );
  return { onToggle };
}

describe("AppSidebar", () => {
  it("lists the boards of the workspace you are in", () => {
    mount();

    expect(screen.getByRole("link", { name: /Roadmap/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Bugs/ })).toBeTruthy();
  });

  it("works out the workspace from the open board", () => {
    // The board route knows its board id but not its workspace until the board
    // itself loads, and picking the wrong workspace for a second is worse than
    // deriving it from what is already here.
    mount({ currentBoardId: "b-9", currentWorkspaceId: null });

    expect(screen.getByRole("link", { name: /Acme/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Roadmap/ })).toBeNull();
  });

  it("marks the board you are looking at", () => {
    mount();

    expect(screen.getByRole("link", { name: /Roadmap/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Bugs/ }).getAttribute("aria-current")).toBeNull();
  });

  it("leaves archived boards out", () => {
    // A nav list is for the places you are going. Archived boards live on the
    // workspace home, where deciding what to do with them belongs.
    mount();

    expect(screen.queryByRole("link", { name: /Old things/ })).toBeNull();
  });

  it("keeps the board names reachable when collapsed", () => {
    // Collapsed still has to say which board is which, so the accessible name
    // survives even though the text does not.
    mount({ collapsed: true });

    expect(screen.getByRole("link", { name: /Roadmap/ })).toBeTruthy();
  });

  it("toggles", async () => {
    const user = userEvent.setup();
    const { onToggle } = mount();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onToggle).toHaveBeenCalled();
  });

  it("says which way the toggle goes", () => {
    mount({ collapsed: true });

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("offers a switcher only when there is more than one workspace", () => {
    mount();
    expect(screen.getByRole("button", { name: "Switch workspace" })).toBeTruthy();

    cleanup();
    // A switcher offering a single choice is a control that does nothing, and
    // one workspace is the common case until somebody is invited elsewhere.
    mount({ workspaces: [WORKSPACES[0]] });
    expect(screen.queryByRole("button", { name: "Switch workspace" })).toBeNull();
    expect(screen.getByText("Ada's workspace")).toBeTruthy();
  });

  it("points Members at the workspace being shown", () => {
    mount({ currentBoardId: "b-9" });

    expect(screen.getByRole("link", { name: "Members" }).getAttribute("href")).toBe(
      "/workspace/w-2/members"
    );
  });

  it("shows placeholders rather than an empty workspace while loading", () => {
    // Null is "still finding out". Rendering it as "no boards" would claim
    // something false about a request that merely has not landed.
    mount({ workspaces: null });

    expect(screen.queryByText(/No boards yet/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Roadmap/ })).toBeNull();
  });

  it("says so when a workspace genuinely has no boards", () => {
    mount({ workspaces: [workspace("w-3", "Empty", [])], currentBoardId: null });

    expect(screen.getByText(/No boards yet/)).toBeTruthy();
  });
});
