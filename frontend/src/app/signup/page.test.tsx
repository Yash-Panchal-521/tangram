// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignupPage from "@/app/signup/page";
import { api } from "@/lib/api";

const replace = vi.fn();
const createUser = vi.fn();
const updateProfile = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: {} }));
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => createUser(...args),
  updateProfile: (...args: unknown[]) => updateProfile(...args),
}));

let currentUser: { uid: string } | null = null;
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: currentUser, loading: false, getToken: async () => "token" }),
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ mode: "light", toggleMode: vi.fn() }) }));

function setSearch(search: string) {
  window.history.replaceState({}, "", `/signup${search}`);
}

beforeEach(() => {
  replace.mockReset();
  updateProfile.mockReset().mockResolvedValue(undefined);
  createUser.mockReset().mockResolvedValue({ user: { getIdToken: vi.fn() } });
  currentUser = null;
  setSearch("");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function signUp() {
  const user = userEvent.setup();
  render(<SignupPage />);

  await user.type(screen.getByLabelText("Display name"), "Ada Lovelace");
  // Cleared first: with an invitation the field arrives prefilled, and typing
  // into it would concatenate two addresses into one invalid one.
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "correct-horse");
  await user.click(screen.getByRole("button", { name: /Create account/ }));
}

describe("SignupPage — where a new account lands", () => {
  it("goes straight to the welcome screen", async () => {
    await signUp();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
  });

  it("never routes through the board resolver on the way", async () => {
    // /board answers "which board should this person open?" by fetching their
    // workspaces -- a question with no answer for an account created a moment
    // ago. Going via it showed a board skeleton for one frame and then replaced
    // it with the welcome screen, which reads as a glitch rather than a step.
    await signUp();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalledWith("/board");
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("refreshes the token before navigating anywhere", async () => {
    // updateProfile doesn't invalidate the token just minted, so without this
    // the backend's first upsert sees no `name` claim and names the user after
    // their email local-part -- forever, on every avatar and cursor.
    const getIdToken = vi.fn();
    createUser.mockResolvedValue({ user: { getIdToken } });

    await signUp();

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it("honours a destination that was actually asked for", async () => {
    setSearch("?next=%2Fboards");
    await signUp();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/boards"));
  });

  it("ignores an off-site destination and still goes to welcome", async () => {
    // Open redirect: a phishing page reached straight after a genuine sign-up is
    // a convincing place to ask for the password again.
    setSearch("?next=https%3A%2F%2Fevil.example");
    await signUp();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
  });

  it("returns to the invitation instead, when there is one", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      workspaceName: "Acme Team",
      role: "Editor",
      invitedByName: "Ada",
      email: "sam@company.com",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    } as never);
    setSearch("?invite=tok_abc");

    await signUp();

    // Accepting is what the whole trip was for. /welcome would offer to build a
    // workspace to somebody who just joined one.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite/tok_abc?accept=1"));
    expect(replace).not.toHaveBeenCalledWith("/welcome");
  });

  it("stays put and explains when sign-up fails", async () => {
    createUser.mockRejectedValue({ code: "auth/email-already-in-use" });

    await signUp();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("SignupPage — somebody who is already signed in", () => {
  it("goes to the board resolver, not the welcome screen", async () => {
    // This branch is a person who had an account before opening the page, so
    // whether they have a board is genuinely unknown -- which is the question
    // the resolver exists to answer.
    currentUser = { uid: "u1" };
    render(<SignupPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/board"));
  });
});
