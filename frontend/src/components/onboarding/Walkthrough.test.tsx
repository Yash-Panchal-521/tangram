// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Walkthrough, availableSteps, type TourStep } from "@/components/onboarding/Walkthrough";
import { anchoredPosition } from "@/components/onboarding/Spotlight";

afterEach(cleanup);

const STEPS: TourStep[] = [
  { target: "[data-tour='one']", title: "First", body: "b1" },
  { target: "[data-tour='two']", title: "Second", body: "b2" },
  { target: "[data-tour='three']", title: "Third", body: "b3" },
];

function Host({ present, onFinish }: { present: string[]; onFinish?: () => void }) {
  return (
    <div>
      {present.map((name) => (
        <div key={name} data-tour={name} />
      ))}
      <Walkthrough steps={STEPS} onFinish={onFinish ?? (() => {})} />
    </div>
  );
}

describe("availableSteps", () => {
  it("keeps only the steps whose anchor exists", () => {
    // A detached fragment, not document.body. Assigning to body.innerHTML would
    // survive Testing Library's cleanup -- it only removes the containers it
    // created -- and every later test would then find anchors it never rendered.
    const root = document.createElement("div");
    root.innerHTML = `<div data-tour="one"></div><div data-tour="three"></div>`;

    // A tour is written against a layout, but this one runs on a board with
    // varying contents -- no cards yet, a viewer with no add button. A step
    // spotlighting nothing reads as a broken feature.
    expect(availableSteps(STEPS, root).map((s) => s.title)).toEqual(["First", "Third"]);
  });
});

describe("Walkthrough", () => {
  it("steps forward and back, showing its position", async () => {
    const user = userEvent.setup();
    render(<Host present={["one", "two", "three"]} />);

    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();

    await user.click(screen.getByText("Next"));
    expect(screen.getByText("Second")).toBeTruthy();

    await user.click(screen.getByText("Back"));
    expect(screen.getByText("First")).toBeTruthy();
    // No Back on the first step -- removed rather than disabled, since there is
    // nothing transient about being at the beginning (S8.1).
    expect(screen.queryByText("Back")).toBeNull();
  });

  it("counts only the steps it can actually show", () => {
    render(<Host present={["two"]} />);

    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("finishes from the last step", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<Host present={["one"]} onFinish={onFinish} />);

    await user.click(screen.getByText("Done"));

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    render(<Host present={["one", "two"]} onFinish={onFinish} />);

    await user.keyboard("{Escape}");

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than running an empty tour", () => {
    const onFinish = vi.fn();
    render(<Host present={[]} onFinish={onFinish} />);

    expect(onFinish).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("anchoredPosition", () => {
  const panel = { width: 320, height: 160 };
  const viewport = { width: 1280, height: 800 };

  it("sits below the target when there is room", () => {
    const { top } = anchoredPosition({ top: 100, left: 500, width: 200, height: 50 }, panel, viewport);
    expect(top).toBe(164);
  });

  it("flips above when there isn't", () => {
    const { top } = anchoredPosition({ top: 700, left: 500, width: 200, height: 50 }, panel, viewport);
    expect(top).toBe(526);
  });

  it("clamps to the viewport rather than hanging off the left edge", () => {
    const { left } = anchoredPosition({ top: 100, left: 0, width: 40, height: 40 }, panel, viewport);
    expect(left).toBe(14);
  });

  it("clamps on the right edge too", () => {
    const { left } = anchoredPosition(
      { top: 100, left: 1240, width: 40, height: 40 },
      panel,
      viewport
    );
    expect(left).toBe(viewport.width - panel.width - 14);
  });
});
