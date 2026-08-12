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

  it("carries what the loaded header carries", () => {
    render(<BoardSkeleton />);

    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("draws nothing the loaded header no longer has", () => {
    // Pinned in both directions because this file has drifted twice: once
    // describing a header from before the workspace home existed, and again
    // after the navigation moved to the sidebar — promising a Boards crumb and
    // a Members control on every load that then vanished on arrival.
    render(<BoardSkeleton />);

    expect(screen.queryByText("Boards")).toBeNull();
    expect(screen.queryByText("Members")).toBeNull();
    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("draws no navigation, because the shell around it already has", () => {
    // AppShell wraps this, so the sidebar with the mark, the board list and
    // Members is on screen throughout — including through a cold start, which
    // is what the links here used to be for.
    const { container } = render(<BoardSkeleton />);

    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("does not invite a click on a control that cannot work yet", () => {
    const { container } = render(<BoardSkeleton />);

    expect(container.querySelector("button")).toBeNull();
  });

  it("leaves room for the filter bar, which is not role-dependent", () => {
    // 41px of chrome that arrives with any board that has columns. Unlike
    // Create it needs no guess about the caller's role, so pre-drawing it costs
    // nothing and saves a shift (S6.2).
    const { container } = render(<BoardSkeleton />);

    expect(container.querySelectorAll(".h-7").length).toBeGreaterThanOrEqual(5);
  });

  it("does not guess at anything the role decides", () => {
    // Create and the "View only" pill both appear only once the role is known,
    // and guessing wrong shifts the header for everyone it was wrong about.
    render(<BoardSkeleton />);

    expect(screen.queryByText("Create")).toBeNull();
    expect(screen.queryByText("View only")).toBeNull();
  });

  it("lays out the same column geometry as a loaded board", () => {
    const { container } = render(<BoardSkeleton />);

    // Matching widths and gaps are what make arrival shift nothing (S2.2, S6.2).
    const columns = container.querySelectorAll(".basis-0");
    expect(columns.length).toBe(3);
    expect(container.querySelector(".gap-3")).not.toBeNull();
  });

  it("keeps the slow-load note out of the flow", () => {
    const { container } = render(<BoardSkeleton slow />);

    const note = screen.getByText(/server sleeps/);
    // In the flow it would push the columns down at ~4s and yank them back on
    // arrival: two layout shifts caused by explaining the wait.
    expect(note.className).toContain("absolute");
    expect(container.querySelectorAll(".basis-0").length).toBe(3);
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
