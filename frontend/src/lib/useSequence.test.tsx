// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSequence } from "@/lib/useSequence";

function Probe({
  holds,
  active = true,
  skipTimers = false,
  onDone,
}: {
  holds: (number | null)[];
  active?: boolean;
  skipTimers?: boolean;
  onDone?: () => void;
}) {
  const { index, isLast, next, restart } = useSequence({ holds, active, skipTimers, onDone });
  return (
    <div>
      <span data-testid="index">{index}</span>
      <span data-testid="last">{String(isLast)}</span>
      <button onClick={next}>next</button>
      <button onClick={restart}>restart</button>
    </div>
  );
}

const index = () => screen.getByTestId("index").textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSequence — timed", () => {
  it("advances one step per hold", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Probe holds={[100, 200, null]} />);

    expect(index()).toBe("0");
    await act(async () => void vi.advanceTimersByTime(100));
    expect(index()).toBe("1");
    await act(async () => void vi.advanceTimersByTime(200));
    expect(index()).toBe("2");
  });

  it("stops at a null hold and waits to be told", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Probe holds={[100, null, 100]} />);

    await act(async () => void vi.advanceTimersByTime(100));
    await act(async () => void vi.advanceTimersByTime(5000));

    // Without this the "wait for the user" step would tick past on its own,
    // and the manual walkthrough mode would be impossible to express.
    expect(index()).toBe("1");
  });

  it("does not start while inactive", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Probe holds={[100, 100]} active={false} />);

    await act(async () => void vi.advanceTimersByTime(1000));

    expect(index()).toBe("0");
  });

  it("calls onDone when the final timed step elapses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDone = vi.fn();
    render(<Probe holds={[50]} onDone={onDone} />);

    await act(async () => void vi.advanceTimersByTime(50));

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("useSequence — manual", () => {
  it("steps forward on demand and never past the end", async () => {
    const user = userEvent.setup();
    render(<Probe holds={[null, null, null]} />);

    await user.click(screen.getByText("next"));
    expect(index()).toBe("1");
    await user.click(screen.getByText("next"));
    await user.click(screen.getByText("next"));
    expect(index()).toBe("2");
    expect(screen.getByTestId("last").textContent).toBe("true");
  });

  it("restarts to the beginning", async () => {
    const user = userEvent.setup();
    render(<Probe holds={[null, null]} />);

    await user.click(screen.getByText("next"));
    await user.click(screen.getByText("restart"));

    expect(index()).toBe("0");
  });
});

describe("useSequence — skipTimers", () => {
  it("jumps to the final step without running any timer", () => {
    vi.useFakeTimers();
    render(<Probe holds={[1000, 1000, null]} skipTimers />);

    // The reduced-motion path: the ending is delivered, the walk-through isn't.
    expect(index()).toBe("2");
  });
});
