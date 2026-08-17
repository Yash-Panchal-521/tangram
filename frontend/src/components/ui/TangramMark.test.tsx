// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TangramMark } from "@/components/ui/TangramMark";

afterEach(cleanup);

describe("TangramMark", () => {
  it("is four triangles in a tile, not a letter in a box", () => {
    const { container } = render(<TangramMark />);

    expect(container.querySelectorAll("polygon")).toHaveLength(4);
    expect(container.querySelector("rect")?.getAttribute("rx")).toBe("20");
    // The mark it replaced was a glyph. Nothing here should be type.
    expect(container.querySelector("text")).toBeNull();
  });

  it("takes its colours from the theme, so it works in all three palettes", () => {
    // The study was drawn against one palette. A hardcoded cobalt mark sits
    // wrong on amber, so the mark follows the tokens and only the favicon —
    // which browser chrome renders outside the stylesheet — is fixed.
    const { container } = render(<TangramMark />);
    const svg = container.innerHTML;

    expect(svg).toContain("var(--text)");
    expect(svg).toContain("var(--accent)");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("hides itself from assistive tech, because every use sits beside a label", () => {
    // The sidebar link is labelled "All boards" and the invite lockup is
    // followed by the word Tangram. An announced graphic would be a duplicate.
    const { container } = render(<TangramMark />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the favicon's geometry in step with the component", () => {
    // Two files draw one mark: this one in tokens, `app/icon.svg` in fixed
    // colours because a favicon is painted by browser chrome, which cannot read
    // CSS custom properties. Nothing but a test keeps them from drifting.
    // cwd-relative, not `import.meta.url`: this file runs under jsdom, where
    // that is not a file: URL.
    const icon = readFileSync(resolve(process.cwd(), "src/app/icon.svg"), "utf8");
    const { container } = render(<TangramMark />);

    const points = (html: string) =>
      [...html.matchAll(/points="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());

    expect(points(icon)).toEqual(points(container.innerHTML));
    expect(icon).toContain('rx="20"');
  });
});
