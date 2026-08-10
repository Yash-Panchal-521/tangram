// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteView } from "@/components/invite/InviteView";
import { api, ApiError, type InvitationOfferResponse } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

// Mutable so a single file can cover both the signed-out reader and the member
// deciding -- the two halves of this page behave completely differently.
let currentUser: { uid: string; email: string } | null = null;
let authLoading = false;

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: currentUser, loading: authLoading, getToken: async () => "token" }),
}));

vi.mock("@/lib/theme", () => ({ useTheme: () => ({ mode: "light", toggleMode: vi.fn() }) }));

const TOKEN = "tok_abc123";
const PENDING: InvitationOfferResponse = {
  workspaceName: "Acme Team",
  role: "Editor",
  invitedByName: "Ada Lovelace",
  status: "pending",
  // Seven days out, so the copy reads forwards rather than as already expired.
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

beforeEach(() => {
  replace.mockReset();
  currentUser = null;
  authLoading = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(offer: Partial<InvitationOfferResponse> = {}) {
  vi.spyOn(api, "get").mockResolvedValue({ ...PENDING, ...offer } as never);
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined as never);
  render(<InviteView token={TOKEN} />);
  return { post };
}

describe("InviteView — reading the offer", () => {
  it("names the workspace, the role and who sent it", async () => {
    mount();

    expect(await screen.findByText(/Join Acme Team\?/)).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace invited you as/)).toBeTruthy();
    expect(screen.getByText("Editor")).toBeTruthy();
    // The role name alone doesn't say what it lets you do.
    expect(screen.getByText(/add, edit, move and delete/)).toBeTruthy();
  });

  it("reads without being signed in, and both routes come back here", async () => {
    // Deciding whether to make an account is impossible if you can't see what
    // it would be for.
    mount();

    const create = await screen.findByRole("link", { name: /Create an account to join/ });
    expect(create.getAttribute("href")).toBe(`/signup?next=${encodeURIComponent(`/invite/${TOKEN}`)}`);
    expect(screen.getByRole("link", { name: /Sign in/ }).getAttribute("href")).toBe(
      `/login?next=${encodeURIComponent(`/invite/${TOKEN}`)}`
    );
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("fetches the offer without a token", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(PENDING as never);
    render(<InviteView token={TOKEN} />);

    // Sending one would fail for exactly the reader this page exists for.
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/invitations/${TOKEN}`, null));
  });

  it("says when it expires, in the future tense", async () => {
    mount();

    // relativeTime floors the future at "just now", which on an expiry date
    // reads as already gone.
    expect(await screen.findByText(/expires in 7 days/)).toBeTruthy();
  });

  it("does not offer sign-up before the session is known (S2.1)", async () => {
    // Firebase resolves a stored session asynchronously. Showing "Create an
    // account" in the gap is indistinguishable from having been logged out, on
    // the one page where that would send someone to make a second account.
    authLoading = true;
    currentUser = { uid: "u1", email: "sam@company.com" };
    mount();

    expect(await screen.findByText(/Join Acme Team\?/)).toBeTruthy();
    expect(screen.getByText(/Checking your session/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Create an account/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("shows a skeleton while it loads (S2.2)", () => {
    vi.spyOn(api, "get").mockImplementation(() => new Promise(() => {}));
    render(<InviteView token={TOKEN} />);

    expect(screen.getByRole("status").textContent).toContain("Loading this invitation");
  });
});

describe("InviteView — deciding", () => {
  beforeEach(() => {
    currentUser = { uid: "u1", email: "sam@company.com" };
  });

  it("accepts and sends you to your boards", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await user.click(await screen.findByRole("button", { name: /Accept invitation/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/accept`, "token"));
    expect(replace).toHaveBeenCalledWith("/boards");
  });

  it("declines without joining, and says so", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await user.click(await screen.findByRole("button", { name: "Decline" }));

    await waitFor(() => expect(screen.getByText("Turned down.")).toBeTruthy());
    expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/decline`, "token");
    // Declining is not a redirect -- landing on a board you just refused would
    // read as having joined anyway.
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Ada Lovelace can invite you again/)).toBeTruthy();
  });

  it("says which account it would join as, and offers to switch", async () => {
    // The link is not bound to an address, so the account you happen to be
    // signed into is the one that joins. Silently is the wrong way to do that.
    mount();

    expect(await screen.findByText(/Joining as sam@company.com/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Use a different account/ })).toBeTruthy();
  });

  it("disables both buttons while one is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockResolvedValue(PENDING as never);
    vi.spyOn(api, "post").mockImplementation(() => new Promise(() => {}));
    render(<InviteView token={TOKEN} />);

    await user.click(await screen.findByRole("button", { name: /Accept invitation/ }));

    expect((screen.getByRole("button", { name: "Joining…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-reads the offer when the server says it has moved on", async () => {
    const user = userEvent.setup();
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValueOnce(PENDING as never)
      .mockResolvedValueOnce({ ...PENDING, status: "accepted" } as never);
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(409, "That invitation has already been used.")
    );
    render(<InviteView token={TOKEN} />);

    await user.click(await screen.findByRole("button", { name: /Accept invitation/ }));

    // A 409 means it changed under us -- another tab, or the clock. Leaving the
    // dead button on screen would invite a pointless second click.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/already been used/)).toBeTruthy();
  });
});

describe("InviteView — dead ends", () => {
  it("explains an expired invitation instead of offering a button that fails", async () => {
    mount({ status: "expired" });

    expect(await screen.findByText(/This invitation has expired/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  });

  it("explains one that was already used", async () => {
    mount({ status: "accepted" });

    expect(await screen.findByText(/already been used/)).toBeTruthy();
  });

  it("explains one that was turned down", async () => {
    mount({ status: "declined" });

    expect(await screen.findByText(/was turned down/)).toBeTruthy();
  });

  it("points at the one person who can fix a bad link (S3.2)", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "not found"));
    render(<InviteView token={TOKEN} />);

    expect(await screen.findByText(/That link doesn't work/)).toBeTruthy();
    expect(screen.getByText(/Ask whoever invited you to send a fresh link/)).toBeTruthy();
    // Retrying a 404 just fails again; the next action is a person, not a button.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("offers a retry when the failure is ours, not the link's", async () => {
    const user = userEvent.setup();
    const get = vi
      .spyOn(api, "get")
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(PENDING as never);
    render(<InviteView token={TOKEN} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Join Acme Team\?/)).toBeTruthy();
  });
});
