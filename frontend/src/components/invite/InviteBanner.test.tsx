// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteBanner } from "@/components/invite/InviteBanner";
import { api, type InvitationOfferResponse } from "@/lib/api";

const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));

const TOKEN = "tok_abc123";
const OFFER: InvitationOfferResponse = {
  workspaceName: "Acme Team",
  role: "Viewer",
  invitedByName: "Ada Lovelace",
  email: "sam@company.com",
  status: "pending",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

beforeEach(() => replace.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InviteBanner", () => {
  it("says what is being joined, and as what", async () => {
    // This is the context the removed interstitial carried. Without it, sign-up
    // is a bare form with nothing on screen explaining why.
    render(<InviteBanner token={TOKEN} offer={OFFER} />);

    expect(screen.getByText("Acme Team")).toBeTruthy();
    expect(screen.getByText("Viewer")).toBeTruthy();
    expect(screen.getByText(/invited by Ada Lovelace/)).toBeTruthy();
    // The role name alone doesn't say what it lets you do.
    expect(screen.getByText(/see the board and everyone on it live, but not change it/)).toBeTruthy();
  });

  it("gets the article right for a Viewer and an Editor", () => {
    const { unmount } = render(<InviteBanner token={TOKEN} offer={OFFER} />);
    expect(screen.getByText(/as a/)).toBeTruthy();
    unmount();

    render(<InviteBanner token={TOKEN} offer={{ ...OFFER, role: "Editor" }} />);
    expect(screen.getByText(/as an/)).toBeTruthy();
  });

  it("declines without an account, and without a token", async () => {
    // Requiring someone to register before they can refuse is the opposite of
    // the point. The invitation token already carries this authority.
    const user = userEvent.setup();
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined as never);
    render(<InviteBanner token={TOKEN} offer={OFFER} />);

    await user.click(screen.getByRole("button", { name: /Decline this invitation/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/invitations/${TOKEN}/decline`, null)
    );
    // Handed to the invite page, which reads the status back and renders the
    // turned-down state, rather than this banner growing a second identity.
    expect(replace).toHaveBeenCalledWith(`/invite/${TOKEN}`);
  });

  it("declines with a POST, never a link", () => {
    // A mail scanner or link-preview fetcher following a GET would refuse an
    // invitation on someone's behalf.
    render(<InviteBanner token={TOKEN} offer={OFFER} />);

    const decline = screen.getByRole("button", { name: /Decline this invitation/ });
    expect(decline.tagName).toBe("BUTTON");
    expect(screen.queryByRole("link", { name: /Decline/ })).toBeNull();
  });

  it("stays put and explains when declining fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "post").mockRejectedValue(new TypeError("network"));
    render(<InviteBanner token={TOKEN} offer={OFFER} />);

    await user.click(screen.getByRole("button", { name: /Decline this invitation/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach Tangram");
    expect(replace).not.toHaveBeenCalled();
    // Re-enabled, or a failed decline is a dead control.
    expect(
      (screen.getByRole("button", { name: /Decline this invitation/ }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("disables the control while the decline is in flight", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "post").mockImplementation(() => new Promise(() => {}));
    render(<InviteBanner token={TOKEN} offer={OFFER} />);

    await user.click(screen.getByRole("button", { name: /Decline this invitation/ }));

    expect((screen.getByRole("button", { name: "Declining…" }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
