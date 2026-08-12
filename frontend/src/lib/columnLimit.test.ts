import { describe, expect, it } from "vitest";
import { limitLabel, limitMessage, limitState } from "@/lib/columnLimit";

const none = { minCards: null, maxCards: null };

describe("limitState", () => {
  it("says nothing about a column with no limits", () => {
    expect(limitState(0, none)).toBe("none");
    expect(limitState(99, none)).toBe("none");
  });

  it("treats the maximum as inclusive", () => {
    // At the limit is fine — a limit of five means five is allowed. Off by one
    // here would light the board up red on every full column.
    const limits = { minCards: null, maxCards: 5 };
    expect(limitState(5, limits)).toBe("ok");
    expect(limitState(6, limits)).toBe("over");
  });

  it("treats the minimum as inclusive too", () => {
    const limits = { minCards: 2, maxCards: null };
    expect(limitState(2, limits)).toBe("ok");
    expect(limitState(1, limits)).toBe("under");
  });

  it("reads a maximum of zero as a real limit, not an absent one", () => {
    // "Nothing should be in progress here" is a thing a team can mean, so zero
    // cannot collapse into "no limit".
    const limits = { minCards: null, maxCards: 0 };
    expect(limitState(0, limits)).toBe("ok");
    expect(limitState(1, limits)).toBe("over");
  });

  it("prefers over when a column is somehow both", () => {
    // Unreachable through the API, which rejects a minimum above a maximum —
    // but the reading has to be defined rather than depending on branch order.
    expect(limitState(10, { minCards: 20, maxCards: 5 })).toBe("over");
  });

  it("holds an empty column against its minimum", () => {
    expect(limitState(0, { minCards: 1, maxCards: null })).toBe("under");
  });
});

describe("limitMessage", () => {
  it("says the breach in words as well as colour (S5.2)", () => {
    // Colour alone fails for anyone who cannot tell red from amber, and again
    // for anyone never told what the colours mean here.
    expect(limitMessage(6, { minCards: null, maxCards: 5 })).toContain("Over the limit");
    expect(limitMessage(1, { minCards: 3, maxCards: null })).toContain("Under the minimum");
  });

  it("stays quiet when there is nothing to announce", () => {
    expect(limitMessage(3, { minCards: null, maxCards: 5 })).toBeNull();
    expect(limitMessage(3, none)).toBeNull();
  });

  it("names the numbers, so the message is actionable on its own", () => {
    expect(limitMessage(7, { minCards: null, maxCards: 5 })).toBe(
      "Over the limit — 7 cards, maximum 5."
    );
  });
});

describe("limitLabel", () => {
  it("reads as a fraction when there is a maximum", () => {
    expect(limitLabel({ minCards: null, maxCards: 5 }, 3)).toBe("3/5");
  });

  it("names the minimum when that is the only limit", () => {
    // "3/2" would read as over a maximum of two.
    expect(limitLabel({ minCards: 2, maxCards: null }, 3)).toBe("3 · min 2");
  });

  it("is nothing at all without limits, so the plain count shows instead", () => {
    expect(limitLabel(none, 3)).toBeNull();
  });
});
