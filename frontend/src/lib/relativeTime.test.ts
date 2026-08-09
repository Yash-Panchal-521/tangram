import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/relativeTime";

const NOW = new Date("2026-08-09T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("collapses anything recent to 'just now'", () => {
    expect(relativeTime(ago(2_000), NOW)).toBe("just now");
    expect(relativeTime(ago(44_000), NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(relativeTime(ago(4 * 86_400_000), NOW)).toBe("4d ago");
  });

  it("says yesterday rather than '1d ago'", () => {
    expect(relativeTime(ago(86_400_000), NOW)).toBe("yesterday");
  });

  it("does not go negative when a clock runs ahead", () => {
    // Server and browser clocks disagree, and a timestamp a few seconds in the
    // future must not render as "in -1 minutes".
    expect(relativeTime(new Date(NOW + 5_000).toISOString(), NOW)).toBe("just now");
  });

  it("degrades to 'recently' rather than NaN on an unparseable date", () => {
    expect(relativeTime("not a date", NOW)).toBe("recently");
  });
});
