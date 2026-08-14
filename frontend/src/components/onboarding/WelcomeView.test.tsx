// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_TEMPLATES } from "@/lib/boardTemplates";
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
    // Each column is its own chip now, rather than one joined string.
    // Still the same claim: the choice shows what it produces.
    for (const column of ["To Do", "In Progress", "Done"]) {
      expect(screen.getAllByText(column).length).toBeGreaterThan(0);
    }
  });

  it("works with nothing typed at all", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await screen.findByLabelText("Workspace");
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    await user.click(screen.getByRole("button", { name: /^Skip/ }));

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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

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
    const submit = screen.getByRole("button", { name: /Create board/ });
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
    await user.click(screen.getByRole("button", { name: /Create board/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");
    expect((screen.getByRole("button", { name: /Create board/ }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("shows a skeleton while it works out whether you need setting up (S2.2)", () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => {}));
    render(<WelcomeView />);

    expect(screen.getByRole("status").textContent).toContain("Getting things ready");
  });
});

describe("WelcomeView — the v7 shape", () => {
  // This screen redirects to /login when signed out, so it cannot be looked at
  // in a browser without an account — the same gap that let three UI defects
  // reach production during v3. What can be checked is that the structure the
  // design specifies is the structure that renders.

  it("has no brand panel, unlike the two auth routes", async () => {
    // First run is a page you act on, not a door you come through. The design
    // gives it the full width and one centred column, and the accent panel that
    // belongs on /login would halve the space the template list needs.
    const { container } = render(<WelcomeView />);
    await screen.findByText("First run");

    expect(container.querySelector("[class*='bg-accent'][class*='basis-']")).toBeNull();
    expect(container.querySelector("[class*='max-w-[800px]']")).toBeTruthy();
  });

  it("opens the template list with a heavy rule and separates rows with hairlines", async () => {
    // The design's device for a list of choices: a full --text line above, then
    // --border-2 between rows. It reads as a table rather than a stack of cards,
    // which is what the previous radio boxes were.
    render(<WelcomeView />);
    await screen.findByText("First run");

    const fieldset = document.querySelector("fieldset");
    expect(fieldset?.className).toContain("border-t");
    expect(fieldset?.className).toContain("border-text");
    expect(fieldset?.querySelectorAll("label").length).toBe(BOARD_TEMPLATES.length);
  });

  it("marks exactly one row selected, and says so in words", async () => {
    // The radio is visually hidden, so "Selected" is the only thing carrying the
    // state for a sighted reader. If it ever renders on two rows or none, the
    // list has stopped saying what it will do.
    render(<WelcomeView />);
    await screen.findByText("First run");

    expect(screen.getAllByText("Selected")).toHaveLength(1);
    expect(screen.getAllByText("Choose")).toHaveLength(BOARD_TEMPLATES.length - 1);
  });

  it("keeps the radios operable even though they are visually hidden", async () => {
    // `sr-only`, not `display:none` — the label is the target, but the input has
    // to stay focusable and checkable or the list becomes mouse-only (S5.x).
    render(<WelcomeView />);
    await screen.findByText("First run");

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(BOARD_TEMPLATES.length);
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("closes with the three orientation notes", async () => {
    render(<WelcomeView />);
    await screen.findByText("First run");

    // Scoped to the notes, because the template rows are numbered too and "01"
    // appears twice on the page. Only one of them is announced -- the row number
    // is aria-hidden, since it is an index rather than information.
    const notes = document.querySelectorAll("p.text-warn");
    expect([...notes].map((n) => n.textContent)).toEqual(["01", "02", "03"]);
    expect(screen.getByText(/priority, labels, one assignee/)).toBeTruthy();
  });

  it("says what skipping does, rather than just 'Skip'", async () => {
    // Skipping produces exactly what the automatic bootstrap produced before
    // this screen existed. Naming that stops it reading as the lesser path.
    render(<WelcomeView />);
    await screen.findByText("First run");

    expect(screen.getByRole("button", { name: /Skip — start from an empty board/ })).toBeTruthy();
  });
});
