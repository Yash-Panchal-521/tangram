// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHomeView } from "@/components/workspace/WorkspaceHomeView";
import { api, type WorkspaceSummaryResponse } from "@/lib/api";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "u1", displayName: "Yash P.", email: "y@example.com" },
    loading: false,
    getToken: async () => "token",
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ mode: "light", toggleMode: vi.fn() }),
}));

const NOW = new Date().toISOString();

function workspaces(role: "Owner" | "Editor" | "Viewer" = "Owner"): WorkspaceSummaryResponse[] {
  return [
    {
      id: "ws-1",
      name: "Acme",
      role,
      boards: [
        { id: "b-1", name: "Roadmap", archived: false, updatedAt: NOW },
        { id: "b-2", name: "Old plans", archived: true, updatedAt: NOW },
      ],
    },
  ];
}

beforeEach(() => push.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(data: WorkspaceSummaryResponse[] | Error = workspaces()) {
  vi.spyOn(api, "get").mockImplementation(async () => {
    if (data instanceof Error) throw data;
    return data as never;
  });
  const post = vi.spyOn(api, "post").mockResolvedValue({ id: "new-board" } as never);
  const patch = vi.spyOn(api, "patch").mockResolvedValue(undefined as never);
  render(<WorkspaceHomeView />);
  return { post, patch };
}

describe("WorkspaceHomeView", () => {
  it("lists each workspace with your role and its active boards", async () => {
    mount();

    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Roadmap")).toBeTruthy();
  });

  it("keeps archived boards out of the way but reachable", async () => {
    mount();
    const user = userEvent.setup();

    await screen.findByText("Roadmap");
    // A board that vanished entirely would read as data loss.
    expect(screen.queryByText("Old plans")).toBeNull();

    await user.click(screen.getByText("Show 1 archived board"));

    expect(screen.getByText("Old plans")).toBeTruthy();
  });

  it("opens a newly created board rather than leaving you on the list", async () => {
    const { post } = mount();
    const user = userEvent.setup();

    await screen.findByText("Acme");
    await user.click(screen.getByRole("button", { name: "New board" }));
    await user.type(screen.getByLabelText("New board in Acme"), "Q3 planning");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/workspaces/ws-1/boards", "token", { name: "Q3 planning" })
    );
    expect(push).toHaveBeenCalledWith("/board/new-board");
  });

  it("renames a board and discards the edit on Escape", async () => {
    const { patch } = mount();
    const user = userEvent.setup();

    await screen.findByText("Roadmap");
    await user.click(screen.getByRole("button", { name: "Rename Roadmap" }));

    const field = screen.getByLabelText("Rename Roadmap");
    await user.clear(field);
    await user.type(field, "Renamed{Escape}");

    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText("Roadmap")).toBeTruthy();
  });

  it("confirms before archiving, naming the consequence (S4.2)", async () => {
    const { post } = mount();
    const user = userEvent.setup();

    await screen.findByText("Roadmap");
    await user.click(screen.getByRole("button", { name: "Archive Roadmap" }));

    expect(screen.getByText("Archive “Roadmap”?")).toBeTruthy();
    expect(screen.getByText(/keeps everything on it/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Archive board" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/boards/b-1/archive", "token", {})
    );
  });

  it("hides archive from an editor but keeps rename (S8.1)", async () => {
    mount(workspaces("Editor"));
    const user = userEvent.setup();

    await screen.findByText("Roadmap");
    expect(screen.getByRole("button", { name: "Rename Roadmap" })).toBeTruthy();
    // Archiving changes what the whole workspace sees, so it is owner-only --
    // and removed for the role rather than shown disabled.
    expect(screen.queryByRole("button", { name: "Archive Roadmap" })).toBeNull();

    await user.click(screen.getByText("Show 1 archived board"));
    expect(screen.queryByRole("button", { name: "Restore Old plans" })).toBeNull();
  });

  it("gives a viewer no board controls at all", async () => {
    mount(workspaces("Viewer"));

    await screen.findByText("Roadmap");
    expect(screen.queryByRole("button", { name: "New board" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename Roadmap" })).toBeNull();
  });

  it("explains an empty workspace and names the next action (S2.3)", async () => {
    mount([{ id: "ws-2", name: "Empty", role: "Owner", boards: [] }]);

    expect(await screen.findByText(/No boards here yet\. Create one/)).toBeTruthy();
  });

  it("says what happened when the list cannot be loaded (S3.6)", async () => {
    mount(new TypeError("network"));

    expect(await screen.findByText(/Can't reach Tangram/)).toBeTruthy();
  });

  it("shows a skeleton while loading rather than an empty page (S2.2)", () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => {}));
    render(<WorkspaceHomeView />);

    const status = screen.getByRole("status");
    expect(within(status).getByText("Loading your workspaces…")).toBeTruthy();
  });
});
