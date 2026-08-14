// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { THEMES, themeInitScript } from "@/lib/theme";

/**
 * The blocking script that paints the first frame.
 *
 * Tested by running it, rather than by reading it: it is a string that never
 * passes through the type checker, so nothing else would catch a typo in it —
 * and it is the one piece of theming that runs before React exists.
 */
function runInitScript() {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
  new Function(themeInitScript)();
}

beforeEach(() => {
  localStorage.clear();
});

describe("themeInitScript", () => {
  it("applies a stored palette and mode", () => {
    localStorage.setItem("tangram-theme", "cobalt");
    localStorage.setItem("tangram-mode", "dark");

    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("cobalt");
    expect(document.documentElement.dataset.mode).toBe("dark");
  });

  it("falls back when the stored palette no longer exists", () => {
    // What happens the first time a palette is renamed or dropped: anyone who
    // had it selected keeps the dead name, `[data-theme="gone"]` matches no
    // block, and every token resolves to nothing — no background, no text
    // colour — until they think to clear site data.
    localStorage.setItem("tangram-theme", "sunset-v2");

    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("obsidian");
  });

  it("falls back on a mode that is not a mode", () => {
    localStorage.setItem("tangram-mode", "sepia");

    runInitScript();

    expect(document.documentElement.dataset.mode).toBe("light");
  });

  it("defaults when nothing is stored at all", () => {
    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("obsidian");
    expect(document.documentElement.dataset.mode).toBe("light");
  });

  it("still paints something when storage throws", () => {
    // Private browsing and blocked storage both throw on read. Leaving the
    // attributes unset would be the unstyled case all over again.
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("obsidian");
    expect(document.documentElement.dataset.mode).toBe("light");

    if (original) Object.defineProperty(window, "localStorage", original);
  });

  it("knows every palette the stylesheet defines", () => {
    // This list and globals.css have to change together — nothing can read
    // which [data-theme] blocks exist at runtime. A palette in one and not the
    // other is either an option that does nothing or a block nobody can reach.
    expect(THEMES.map((t) => t.id)).toEqual(["obsidian", "solar", "cobalt"]);
  });
});
