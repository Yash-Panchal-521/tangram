// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemePicker } from "@/components/ui/ThemePicker";

const setTheme = vi.fn();
let theme = "terracotta";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme, mode: "light", setTheme }),
  THEMES: [
    { id: "terracotta", name: "Terracotta", hint: "Warm, earthy" },
    { id: "slate", name: "Slate", hint: "Neutral grey" },
    { id: "graphite", name: "Graphite", hint: "Near-monochrome" },
  ],
}));

beforeEach(() => {
  theme = "terracotta";
  setTheme.mockClear();
});

afterEach(cleanup);

describe("ThemePicker", () => {
  it("is a radio group, since exactly one palette is on", () => {
    render(<ThemePicker />);

    expect(screen.getByRole("radiogroup", { name: "Colour theme" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks the palette in use", () => {
    render(<ThemePicker />);

    expect(screen.getByRole("radio", { name: /Terracotta/ }).getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(screen.getByRole("radio", { name: /Slate/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("switches", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("radio", { name: /Graphite/ }));

    expect(setTheme).toHaveBeenCalledWith("graphite");
  });

  it("paints each swatch in its own palette, not the active one", () => {
    // The one thing a theme picker must not do is show every option looking
    // the same. Each swatch re-scopes the tokens for its own subtree.
    const { container } = render(<ThemePicker />);

    const swatches = container.querySelectorAll("[data-theme]");
    expect([...swatches].map((s) => s.getAttribute("data-theme"))).toEqual([
      "terracotta",
      "slate",
      "graphite",
    ]);
  });

  it("carries the current mode into the swatches", () => {
    // A palette's dark half is a different set of colours; previewing it in
    // light while the app is dark would preview the wrong thing.
    const { container } = render(<ThemePicker />);

    expect(container.querySelector("[data-theme]")?.getAttribute("data-mode")).toBe("light");
  });

  it("drops the descriptions when compact, keeping the names", () => {
    render(<ThemePicker compact />);

    expect(screen.getByRole("radio", { name: /Slate/ })).toBeTruthy();
    expect(screen.queryByText("Neutral grey")).toBeNull();
  });
});
