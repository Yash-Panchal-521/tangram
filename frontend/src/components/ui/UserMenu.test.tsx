// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "@/components/ui/UserMenu";

const signOut = vi.fn(async () => {});
const toggleMode = vi.fn();
const setTheme = vi.fn();
let mode: "light" | "dark" = "light";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "u1", displayName: "Yash P.", email: "yash@example.com" },
    signOut,
  }),
}));

// The menu now also carries the palette picker, so the mock has to stand in
// for the whole module rather than the one hook it used to need.
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "terracotta", mode, toggleMode, setTheme }),
  THEMES: [
    { id: "terracotta", name: "Terracotta", hint: "Warm" },
    { id: "slate", name: "Slate", hint: "Neutral" },
  ],
}));

beforeEach(() => {
  mode = "light";
  signOut.mockClear();
  toggleMode.mockClear();
  setTheme.mockClear();
});
afterEach(cleanup);

async function openMenu() {
  const user = userEvent.setup();
  render(<UserMenu />);
  await user.click(screen.getByRole("button", { name: /Account menu/ }));
  return user;
}

describe("UserMenu", () => {
  it("names who you are signed in as", async () => {
    await openMenu();

    expect(screen.getByText("Yash P.")).toBeTruthy();
    expect(screen.getByText("yash@example.com")).toBeTruthy();
  });

  it("reports its expanded state", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    const trigger = screen.getByRole("button", { name: /Account menu/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("carries the theme toggle, which is a personal preference not a board action", async () => {
    const user = await openMenu();

    await user.click(screen.getByRole("menuitem", { name: /Switch to dark mode/ }));

    expect(toggleMode).toHaveBeenCalledTimes(1);
  });

  it("labels the theme item by where it takes you, not where you are", async () => {
    mode = "dark";
    await openMenu();

    expect(screen.getByRole("menuitem", { name: /Switch to light mode/ })).toBeTruthy();
  });

  it("signs out", async () => {
    const user = await openMenu();

    await user.click(screen.getByRole("menuitem", { name: /Sign out/ }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("omits the walkthrough entry where there is no walkthrough", async () => {
    // The members page passes no handler; offering a tour that leads nowhere is
    // worse than not offering one.
    await openMenu();

    expect(screen.queryByRole("menuitem", { name: /Show me around/ })).toBeNull();
  });

  it("offers the walkthrough when the page has one, and closes on the way", async () => {
    const onShowMeAround = vi.fn();
    const user = userEvent.setup();
    render(<UserMenu onShowMeAround={onShowMeAround} />);

    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitem", { name: /Show me around/ }));

    expect(onShowMeAround).toHaveBeenCalledTimes(1);
    // The menu must get out of the way, or it covers the first thing the tour
    // spotlights.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = await openMenu();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Account menu/ }));
  });
});
