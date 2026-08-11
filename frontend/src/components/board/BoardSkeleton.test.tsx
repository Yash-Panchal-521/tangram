// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardSkeleton } from "@/components/board/BoardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

afterEach(cleanup);

describe("BoardSkeleton", () => {
  it("announces the wait once rather than through every grey bar", () => {
    render(<BoardSkeleton />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading board…")).toBeTruthy();
  });

  it("draws the real header, whose height never depends on the response", () => {
    const { container } = render(<BoardSkeleton />);

    const header = container.querySelector("header")!;
    expect(header.className).toContain("h-[52px]");
  });

  it("carries every control the loaded header has", () => {
    // This drifted once already: the skeleton still described the header as it
    // stood before the activity feed, the workspace home and the account menu
    // existed, so three controls appeared out of nowhere on arrival.
    render(<BoardSkeleton />);

    expect(screen.getByText("Boards")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByText("Members")).toBeTruthy();
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("offers a way out while the server wakes up", () => {
    // A cold start takes up to a minute. Both crumbs are real links because
    // nothing about them depends on the board, and being stuck on a page that
    // is still deciding what it is would otherwise mean using the back button.
    const { container } = render(<BoardSkeleton />);

    const out = container.querySelectorAll('a[href="/boards"]');
    expect(out.length).toBe(2);
  });

  it("does not invite a click on a control that cannot work yet", () => {
    const { container } = render(<BoardSkeleton />);

    // Real labels for their width, but inert -- no button, and none of the
    // hover or cursor affordances the loaded header's controls carry.
    expect(container.querySelector("button")).toBeNull();
    const activity = screen.getByText("Activity").closest("span")!;
    expect(activity.className).not.toContain("cursor-pointer");
    expect(activity.className).not.toContain("hover:");
    expect(activity.getAttribute("aria-hidden")).toBe("true");
  });

  it("lays out the same column geometry as a loaded board", () => {
    const { container } = render(<BoardSkeleton />);

    // Matching widths and gaps are what make arrival shift nothing (S2.2, S6.2).
    const columns = container.querySelectorAll(".w-\\[262px\\]");
    expect(columns.length).toBe(3);
    expect(container.querySelector(".gap-3\\.5")).not.toBeNull();
  });

  it("keeps the slow-load note out of the flow", () => {
    const { container } = render(<BoardSkeleton slow />);

    const note = screen.getByText(/server sleeps/);
    // In the flow it would push the columns down at ~4s and yank them back on
    // arrival: two layout shifts caused by explaining the wait.
    expect(note.className).toContain("absolute");
    expect(container.querySelectorAll(".w-\\[262px\\]").length).toBe(3);
  });

  it("says nothing about the wait until it is actually slow (S2.4)", () => {
    render(<BoardSkeleton />);
    expect(screen.queryByText(/server sleeps/)).toBeNull();
  });

  it("hides its placeholder bars from assistive tech", () => {
    const { container } = render(<BoardSkeleton />);

    const bars = container.querySelectorAll(".animate-pulse");
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => expect(bar.getAttribute("aria-hidden")).toBe("true"));
  });
});

describe("Skeleton primitive", () => {
  it("carries no default radius, so a caller's rounded-* can never lose", () => {
    // className is appended, and a second rounded-* is decided by stylesheet
    // order rather than argument order (S1.3).
    const { container } = render(<Skeleton className="rounded-full h-4 w-4" />);

    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("rounded-full");
    expect(el.className.split(" ")).not.toContain("rounded");
  });

  it("always pulses and always hides itself from a screen reader", () => {
    const { container } = render(<Skeleton className="h-2" />);

    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});
