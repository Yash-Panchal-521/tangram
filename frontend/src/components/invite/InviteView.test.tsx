// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteView } from "@/components/invite/InviteView";
import { api, ApiError, type InvitationOfferResponse } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

// Mutable so one file can cover the three people who arrive here: nobody signed
// in, somebody signed in who clicked a link, and somebody coming back from
// sign-up. They behave completely differently.
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
  email: "sam@company.com",
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

function mount(offer: Partial<InvitationOfferResponse> = {}, autoAccept = false) {
  vi.spyOn(api, "get").mockResolvedValue({ ...PENDING, ...offer } as never);
  const post = vi.spyOn(api, "post").mockResolvedValue(undefined as never);
  render(<InviteView token={TOKEN} autoAccept={autoAccept} />);
  return { post };
}

describe("InviteView — nobody signed in", () => {
  it("goes straight to sign-up rather than showing a button meaning 'continue'", async () => {
    // There is no account to join as yet, so an Accept button here would be a
    // screen whose only real action is to move on.
    mount();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/signup?invite=${TOKEN}`));
  });

  it("does not send anyone away before the session is known (S2.1)", async () => {
    // Firebase resolves a stored session asynchronously. Redirecting in that gap
    // would bounce a signed-in person to sign-up as if they were logged out.
    authLoading = true;
    currentUser = { uid: "u1", email: "sam@company.com" };
    mount();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect on an invitation that cannot be accepted", async () => {
    // Sending someone to make an account for a dead link is worse than telling
    // them it is dead.
    mount({ status: "expired" });

    expect(await screen.findByText(/This invitation has expired/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("fetches the offer without an auth token", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(PENDING as never);
    render(<InviteView token={TOKEN} autoAccept={false} />);

    // Sending one would fail for exactly the reader this endpoint exists for.
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/invitations/${TOKEN}`, null));
  });
});

describe("InviteView — signed in, opened the link", () => {
  beforeEach(() => {
    currentUser = { uid: "u1", email: "sam@company.com" };
  });

  it("asks, rather than joining on arrival", async () => {
    const { post } = mount();

    // The headline names the inviter and the workspace; the particulars —
    // including what the role lets you do — are the property list under it.
    expect(await screen.findByText(/invited you to/)).toBeTruthy();
    // Twice on purpose: once in the headline, once in the Workspace row.
    expect(screen.getAllByText("Acme Team").length).toBe(2);
    expect(screen.getByText("Role")).toBeTruthy();
    expect(screen.getByText(/add, edit, move and delete/)).toBeTruthy();
    // The link isn't bound to an address, and there is no "leave workspace" --
    // silently joining the wrong account would not be undoable.
    expect(post).not.toHaveBeenCalled();
  });

  it("says which account would join, and offers to switch", async () => {
    mount();

    expect(await screen.findByText(/Joining as sam@company.com/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /sign in with another account/ }).getAttribute("href")
    ).toBe(`/login?invite=${TOKEN}`);
  });

  it("says when it expires, in the future tense", async () => {
    mount();

    // relativeTime floors the future at "just now", which on an expiry reads as
    // already gone.
    expect(await screen.findByText(/expires in 7 days/)).toBeTruthy();
  });

  it("accepts with a token, and confirms which account joined", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await user.click(await screen.findByRole("button", { name: /Accept and open workspace/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/accept`, "token"));
    expect(await screen.findByText("You're in.")).toBeTruthy();
    // The account is in its own emphasised span, so match the span, not the
    // sentence around it.
    expect(screen.getByText("sam@company.com")).toBeTruthy();
    expect(screen.getByText(/You joined/).textContent).toContain("as sam@company.com");
    // A result, not a silent redirect -- see the wrong-account case above.
    expect(replace).not.toHaveBeenCalled();
  });

  it("declines without joining, and says so", async () => {
    const user = userEvent.setup();
    const { post } = mount();

    await user.click(await screen.findByRole("button", { name: "Decline" }));

    await waitFor(() => expect(screen.getByText("Turned down.")).toBeTruthy());
    expect(screen.getByText(/Ada Lovelace can invite you again/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    // Declining takes no auth even here: the endpoint is anonymous so the same
    // call works from the sign-up banner, and one path is easier to keep right
    // than two.
    expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/decline`, null);
  });

  it("disables both buttons while one is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "get").mockResolvedValue(PENDING as never);
    vi.spyOn(api, "post").mockImplementation(() => new Promise(() => {}));
    render(<InviteView token={TOKEN} autoAccept={false} />);

    await user.click(await screen.findByRole("button", { name: /Accept and open workspace/ }));

    expect((screen.getByRole("button", { name: "Joining…" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByRole("button", { name: "Decline" }) as HTMLButtonElement).disabled).toBe(
      true
    );
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
    render(<InviteView token={TOKEN} autoAccept={false} />);

    await user.click(await screen.findByRole("button", { name: /Accept and open workspace/ }));

    // A 409 means it changed under us -- another tab, or the clock. Leaving the
    // dead button on screen would invite a pointless second click.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/already been used/)).toBeTruthy();
  });
});

describe("InviteView — back from sign-up", () => {
  beforeEach(() => {
    currentUser = { uid: "u1", email: "sam@company.com" };
  });

  it("accepts without asking again, and opens the board", async () => {
    // They answered by signing up for this. Asking a second time is a screen
    // between them and what they came for.
    const { post } = mount({}, true);

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/accept`, "token"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/board"));
  });

  it("never routes through the first-run setup", async () => {
    // /welcome decides by asking "do you have a board?". Reaching it before the
    // accept lands would offer to build a workspace to someone who just joined
    // one.
    mount({}, true);


    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalledWith("/welcome");
  });

  it("accepts once, not once per render", async () => {
    const { post } = mount({}, true);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/board"));
    expect(post.mock.calls.filter((c) => String(c[0]).endsWith("/accept"))).toHaveLength(1);
  });

  it("falls back to asking if the automatic accept fails", async () => {
    vi.spyOn(api, "get").mockResolvedValue(PENDING as never);
    vi.spyOn(api, "post").mockRejectedValue(new TypeError("network"));
    render(<InviteView token={TOKEN} autoAccept />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");
    // Stranded on a dead end would mean signing up and never joining.
    expect(screen.getByRole("button", { name: /Accept and open workspace/ })).toBeTruthy();
  });
});

describe("InviteView — dead ends", () => {
  beforeEach(() => {
    currentUser = { uid: "u1", email: "sam@company.com" };
  });

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
    render(<InviteView token={TOKEN} autoAccept={false} />);

    expect(await screen.findByText(/That link doesn't work/)).toBeTruthy();
    expect(screen.getByText(/Ask whoever invited you to send a fresh link/)).toBeTruthy();
    // Retrying a 404 fails again by definition; the next action is a person.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("sends a signed-in reader back to their boards", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "not found"));
    render(<InviteView token={TOKEN} autoAccept={false} />);

    const back = await screen.findByRole("link", { name: /Go to your boards/ });
    expect(back.getAttribute("href")).toBe("/board");
  });

  it("sends a signed-out reader to sign in instead", async () => {
    // /board would bounce them to /login anyway, one flash of the wrong page
    // later.
    currentUser = null;
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "not found"));
    render(<InviteView token={TOKEN} autoAccept={false} />);

    const back = await screen.findByRole("link", { name: /Go to sign in/ });
    expect(back.getAttribute("href")).toBe("/login");
  });

  it("offers a retry when the failure is ours, not the link's", async () => {
    const user = userEvent.setup();
    const get = vi
      .spyOn(api, "get")
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(PENDING as never);
    render(<InviteView token={TOKEN} autoAccept={false} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/invited you to/)).toBeTruthy();
  });
});
