// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeView } from "@/components/onboarding/WelcomeView";
import { api } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com" },
    loading: false,
    getToken: async () => "token",
  }),
}));

vi.mock("@/lib/theme", () => ({ useTheme: () => ({ mode: "light", toggleMode: vi.fn() }) }));

beforeEach(() => replace.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(workspaces: unknown = []) {
  vi.spyOn(api, "get").mockResolvedValue(workspaces as never);
  const post = vi.spyOn(api, "post").mockImplementation(async (path: string) => {
    if (path === "/workspaces") return { id: "ws-new" } as never;
    if (path.endsWith("/boards")) return { id: "board-new" } as never;
    return undefined as never;
  });
  render(<WelcomeView />);
  return { post };
}

describe("WelcomeView — defaults", () => {
  it("suggests a workspace name from who you are, not a placeholder", async () => {
    mount();
    // "My Workspace" is what every account used to get, chosen by nobody.
    await waitFor(() =>
      expect((screen.getByLabelText("Workspace") as HTMLInputElement).value).toBe(
        "Ada's workspace"
      )
    );
  });

  it("preselects a template and shows the columns it produces", async () => {
    mount();

    await screen.findByLabelText("Workspace");
    const basic = screen.getByRole("radio", { name: /Basic/ }) as HTMLInputElement;
    expect(basic.checked).toBe(true);
    // The choice only means something if you can see what it makes.
    expect(screen.getByText("To Do · In Progress · Done")).toBeTruthy();
  });

  it("works with nothing typed at all", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/workspaces/ws-new/boards", "token", {
        name: "My board",
        columns: ["To Do", "In Progress", "Done"],
      })
    );
    expect(replace).toHaveBeenCalledWith("/board/board-new");
  });
});

describe("WelcomeView — choices", () => {
  it("sends the chosen template's columns", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    await user.click(screen.getByRole("radio", { name: /Sprint/ }));
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/workspaces/ws-new/boards",
        "token",
        expect.objectContaining({ columns: ["Backlog", "In Progress", "Review", "Done"] })
      )
    );
  });

  it("keeps a name you typed over the suggestion", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    const field = await screen.findByLabelText("Workspace");
    await user.clear(field);
    await user.type(field, "Acme");
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/workspaces", "token", { name: "Acme" })
    );
  });

  it("invites the addresses given, as editors", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    await user.type(
      screen.getByLabelText(/Invite your team/),
      "sam@company.com, ada@company.com"
    );
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/workspaces/ws-new/members", "token", {
        email: "sam@company.com",
        role: "Editor",
      })
    );
    expect(post).toHaveBeenCalledWith("/workspaces/ws-new/members", "token", {
      email: "ada@company.com",
      role: "Editor",
    });
  });

  it("warns about an address that won't send rather than failing the whole setup", async () => {
    const user = userEvent.setup();
    mount();

    await screen.findByLabelText("Workspace");
    await user.type(screen.getByLabelText(/Invite your team/), "not-an-email");

    expect(screen.getByText(/doesn't look like an email address/)).toBeTruthy();
  });

  it("still creates the board when an invite fails", async () => {
    // One bad address must not cost someone the board they just made.
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockResolvedValue([] as never);
    const post = vi.spyOn(api, "post").mockImplementation(async (path: string) => {
      if (path === "/workspaces") return { id: "ws-new" } as never;
      if (path.endsWith("/boards")) return { id: "board-new" } as never;
      throw new Error("invite blew up");
    });
    render(<WelcomeView />);

    await screen.findByLabelText("Workspace");
    await user.type(screen.getByLabelText(/Invite your team/), "sam@company.com");
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/board/board-new"));
    expect(post).toHaveBeenCalledWith("/workspaces/ws-new/members", "token", expect.anything());
  });
});

describe("WelcomeView — skipping", () => {
  it("produces a board without sending any invites", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    await user.type(screen.getByLabelText(/Invite your team/), "sam@company.com");
    await user.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/board/board-new"));
    // Skipping is a real path, not a lesser one -- but it must honour the skip.
    expect(post).not.toHaveBeenCalledWith(
      "/workspaces/ws-new/members",
      "token",
      expect.anything()
    );
  });
});

describe("WelcomeView — guards", () => {
  it("sends someone who already has a board to their boards instead", async () => {
    // An invited teammate, or a returning user. Setting up again is not a thing
    // they need.
    mount([{ id: "ws-1", name: "Acme", role: "Owner", boards: [{ id: "b-1" }] }]);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/boards"));
  });

  it("does not offer a workspace name it would ignore", async () => {
    // Reaching here already owning an empty workspace means the board goes
    // there. An editable name field would be a control that silently does
    // nothing -- which is how this was found in the first place.
    mount([{ id: "ws-existing", name: "Acme", role: "Owner", boards: [] }]);

    await screen.findByLabelText("First board");
    expect(screen.queryByLabelText("Workspace")).toBeNull();
    expect(screen.getByText(/the workspace you already have/)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
  });

  it("reuses an empty workspace rather than stacking a second one", async () => {
    const user = userEvent.setup();
    const { post } = mount([{ id: "ws-existing", name: "Acme", role: "Owner", boards: [] }]);

    await screen.findByLabelText("First board");
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/workspaces/ws-existing/boards",
        "token",
        expect.anything()
      )
    );
    expect(post).not.toHaveBeenCalledWith("/workspaces", "token", expect.anything());
  });

  it("does not create twice when submitted twice quickly", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    const submit = screen.getByRole("button", { name: /Create my board/ });
    await user.click(submit);
    await user.click(submit);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    // A second run would create a second workspace, which is the exact mess the
    // bootstrap was rewritten to avoid.
    expect(post.mock.calls.filter((c) => c[0] === "/workspaces")).toHaveLength(1);
  });

  it("says what happened if setup fails, and lets you try again", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockResolvedValue([] as never);
    vi.spyOn(api, "post").mockRejectedValue(new TypeError("network"));
    render(<WelcomeView />);

    await screen.findByLabelText("Workspace");
    await user.click(screen.getByRole("button", { name: /Create my board/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");
    expect((screen.getByRole("button", { name: /Create my board/ }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("shows a skeleton while it works out whether you need setting up (S2.2)", () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => {}));
    render(<WelcomeView />);

    expect(screen.getByRole("status").textContent).toContain("Getting things ready");
  });
});
