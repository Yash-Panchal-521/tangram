// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSeenOnce } from "@/lib/useSeenOnce";

function Probe({ storageKey = "demo" }: { storageKey?: string }) {
  const { state, markSeen, forget } = useSeenOnce(storageKey);
  return (
    <div>
      <span data-testid="state">{state}</span>
      <button onClick={markSeen}>mark</button>
      <button onClick={forget}>forget</button>
    </div>
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useSeenOnce", () => {
  it("reports unseen for a key that was never stored", () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("unseen");
  });

  it("remembers across mounts", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByText("mark"));
    cleanup();

    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("seen");
  });

  it("keys are independent", async () => {
    const user = userEvent.setup();
    render(<Probe storageKey="a" />);
    await user.click(screen.getByText("mark"));
    cleanup();

    render(<Probe storageKey="b" />);
    expect(screen.getByTestId("state").textContent).toBe("unseen");
  });

  it("forgetting brings it back, which is what makes it demoable", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    await user.click(screen.getByText("mark"));
    await user.click(screen.getByText("forget"));

    expect(screen.getByTestId("state").textContent).toBe("unseen");
  });

  it("treats unreadable storage as seen rather than replaying forever", () => {
    // Private browsing and blocked storage both throw on access. Failing open
    // would replay the introduction on every single visit, which is the more
    // annoying of the two wrong answers.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("seen");
  });

  it("still ends the current run when writing is blocked", async () => {
    const user = userEvent.setup();
    render(<Probe />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    await user.click(screen.getByText("mark"));

    expect(screen.getByTestId("state").textContent).toBe("seen");
  });
});
