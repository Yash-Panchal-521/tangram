import { describe, expect, it } from "vitest";
import { placeMenu } from "@/components/ui/Menu";

// Pure, because jsdom reports every rect as zero — placement is not something a
// render test can check, and it is exactly the part that goes wrong silently.

describe("placeMenu", () => {
  it("hangs below the trigger and lines up with its right edge", () => {
    const at = placeMenu({ bottom: 100, left: 620, right: 700 }, 1000, "right");

    expect(at.top).toBe(104);
    expect(at.right).toBe(300); // 1000 - 700
  });

  it("keeps a right-aligned menu on screen when its trigger is near the left", () => {
    // The case a single clamp misses: pinning the near edge still lets the far
    // edge run off. A column menu on a narrow window sits exactly here.
    const at = placeMenu({ bottom: 40, left: 10, right: 40 }, 400, "right");

    expect(at.right).toBe(212); // 400 - 180 - 8, so the left edge lands on 8
    expect(400 - at.right! - 180).toBeGreaterThanOrEqual(8);
  });

  it("keeps a right-aligned menu off the right edge when the trigger is flush", () => {
    const at = placeMenu({ bottom: 40, left: 960, right: 1000 }, 1000, "right");

    expect(at.right).toBe(8);
  });

  it("clamps a left-aligned menu the same way at both ends", () => {
    expect(placeMenu({ bottom: 0, left: 0, right: 30 }, 1000, "left").left).toBe(8);
    expect(placeMenu({ bottom: 0, left: 990, right: 1000 }, 1000, "left").left).toBe(812);
  });

  it("still returns something usable on a window narrower than the menu", () => {
    // Both clamps fight here; the edge margin wins rather than producing a
    // negative offset that would push the panel off entirely.
    const at = placeMenu({ bottom: 0, left: 5, right: 60 }, 120, "right");

    expect(at.right).toBeGreaterThanOrEqual(8);
  });
});
