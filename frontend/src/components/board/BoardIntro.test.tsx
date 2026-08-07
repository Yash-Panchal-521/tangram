// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardIntro } from "@/components/board/BoardIntro";

let reducedMotion = false;

vi.mock("@/lib/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

beforeEach(() => {
  reducedMotion = false;
  // jsdom gives every element a zero rect, which `measure` would happily accept
  // and then paint the demonstration at the origin. Stubbing it keeps the test
  // about sequencing rather than about jsdom's layout engine.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const zone = this.dataset.introDropzone !== undefined;
    const index = Number(this.dataset.index ?? 0);
    return {
      left: zone ? 100 + index * 300 : 0,
      top: zone ? 50 : 0,
      width: zone ? 262 : 1000,
      height: 400,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Host({
  onDismiss = () => {},
  onAddCard = () => {},
  columns = 3,
}: {
  onDismiss?: () => void;
  onAddCard?: () => void;
  columns?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} data-intro-dropzone data-index={i} />
      ))}
      <BoardIntro boardAreaRef={ref} onDismiss={onDismiss} onAddCard={onAddCard} />
    </div>
  );
}


async function advanceBeats(beats: number[]) {
  for (const ms of beats) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }
}

describe("BoardIntro", () => {
  it("plays through to the finale on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Host />);

    expect(screen.queryByRole("dialog")).toBeNull();

    // Advanced one beat at a time. A single 3600ms jump fires only the first
    // timer: the next is scheduled by an effect that cannot run until React has
    // re-rendered, which happens after the whole window has already elapsed.
    await advanceBeats([900, 1100, 1500]);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Add my first card")).toBeTruthy();
  });

  it("never touches the board — the demonstration is painted, not persisted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onAddCard = vi.fn();
    render(<Host onAddCard={onAddCard} />);

    await advanceBeats([900, 1100, 1500]);

    // The phantom card is inside the intro overlay, not in a column.
    const phantom = screen.getByText("Draft the launch plan");
    expect(phantom.closest("[data-testid='board-intro']")).not.toBeNull();
    expect(onAddCard).not.toHaveBeenCalled();
  });

  it("skips straight to the finale under prefers-reduced-motion (S6.1)", () => {
    reducedMotion = true;
    render(<Host />);

    // No timers advanced: a self-playing animation is precisely what this
    // preference asks not to see, so the user is given the ending directly.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("can be skipped from the very first frame", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} />);

    await user.click(screen.getByText("Skip"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("bails out rather than animating against a board it cannot measure", () => {
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} columns={1} />);

    // One column means there is nowhere to move a card to. Guessing would put
    // the phantom card in the wrong place, which is worse than not running.
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByTestId("board-intro")).toBeNull();
  });

  it("hands the user into the add-card form from the finale", async () => {
    reducedMotion = true;
    const user = userEvent.setup();
    const onAddCard = vi.fn();
    render(<Host onAddCard={onAddCard} />);

    await user.click(screen.getByText("Add my first card"));

    expect(onAddCard).toHaveBeenCalledTimes(1);
  });

  it("closes the finale on Escape", async () => {
    reducedMotion = true;
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} />);

    await user.keyboard("{Escape}");

    expect(onDismiss).toHaveBeenCalled();
  });
});
