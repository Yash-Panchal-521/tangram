// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthField, PasswordRule } from "@/components/auth/AuthField";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ mode: "light", toggleMode: () => {} }),
}));

afterEach(cleanup);

describe("AuthShell", () => {
  it("hides the form while the session is still being resolved (S2.1)", () => {
    render(
      <AuthShell headline="h" subhead="s" checking>
        <button>Sign in</button>
      </AuthShell>
    );

    // The bug this replaces: Firebase resolves a stored session asynchronously,
    // so an already-signed-in visitor was shown a full sign-in form and then
    // redirected out of it — indistinguishable from having been logged out.
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Checking your session");
  });

  it("shows the form once the check is done", () => {
    render(
      <AuthShell headline="h" subhead="s" checking={false}>
        <button>Sign in</button>
      </AuthShell>
    );

    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("AuthField", () => {
  it("associates the label with the control, so clicking it focuses the field", async () => {
    const user = userEvent.setup();
    render(
      <AuthField id="email" label="Email">
        <input id="email" />
      </AuthField>
    );

    await user.click(screen.getByText("Email"));

    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });
});

describe("PasswordRule", () => {
  it("announces met and unmet differently, since the icon is decorative", () => {
    const { rerender } = render(<PasswordRule met={false}>At least 6 characters</PasswordRule>);
    expect(screen.getByText(/not yet met/)).toBeTruthy();

    rerender(<PasswordRule met>At least 6 characters</PasswordRule>);
    expect(screen.getByText(/— met/)).toBeTruthy();
  });
});
