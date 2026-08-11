// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialog } from "@/lib/useDialog";

// Must unmount, not just empty the body. Testing Library only registers its own
// auto-cleanup when Vitest globals are on, and these tests run without them --
// so without this each dialog's document-level keydown listener survives into
// the next test and fights it for the Tab key.
afterEach(cleanup);

function Dialog({
  onClose,
  extraControl = false,
  children,
}: {
  onClose: () => void;
  extraControl?: boolean;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog({ containerRef: ref, onClose });

  return (
    <div ref={ref} role="dialog">
      <button>first</button>
      {extraControl && <button>middle</button>}
      <button>last</button>
      {children}
    </div>
  );
}

function Harness(props: { extraControl?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>trigger</button>
      {open && <Dialog onClose={() => setOpen(false)} {...props} />}
    </>
  );
}

describe("useDialog", () => {
  it("moves focus into the dialog when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger"));

    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("closes on Escape and returns focus to whatever opened it (S5.3, S5.4)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByText("trigger");

    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("wraps Tab from the last control back to the first (S5.5)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger"));
    screen.getByText("last").focus();
    await user.tab();

    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first control round to the last (S5.5)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger"));
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("leaves interior Tab alone, so the browser's own order is preserved", async () => {
    const user = userEvent.setup();
    render(<Harness extraControl />);

    await user.click(screen.getByText("trigger"));
    await user.tab();

    // first -> middle, not first -> last. A trap that intercepted every Tab
    // would have to reimplement tab order, and would get it wrong.
    expect(document.activeElement).toBe(screen.getByText("middle"));
  });

  it("gives Escape to the topmost dialog only (S5.3)", async () => {
    // The regression, twice over: a card modal closed underneath its own date
    // picker, and later underneath a comment's delete confirmation. One Escape
    // dismissed both the thing on top and the thing it was guarding.
    const user = userEvent.setup();
    const closeOuter = vi.fn();
    const closeInner = vi.fn();

    function Stacked() {
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <Dialog onClose={closeOuter}>
          <button onClick={() => setInnerOpen(true)}>open inner</button>
          {innerOpen && <Dialog onClose={closeInner} />}
        </Dialog>
      );
    }

    render(<Stacked />);
    await user.click(screen.getByText("open inner"));
    await user.keyboard("{Escape}");

    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it("hands the key back when the dialog above it closes", async () => {
    // The stack has to shrink, or the outer dialog stays deaf for the rest of
    // its life -- a subtler failure than the one above, because it only shows
    // up on the second Escape.
    const user = userEvent.setup();
    const closeOuter = vi.fn();

    function Stacked() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <Dialog onClose={closeOuter}>
          {innerOpen && <Dialog onClose={() => setInnerOpen(false)} />}
        </Dialog>
      );
    }

    render(<Stacked />);
    await user.keyboard("{Escape}");
    expect(closeOuter).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire initial focus when the caller re-renders", async () => {
    // The regression this guards: `onClose` passed as an inline arrow changes
    // identity every render. If the effect depended on it, every keystroke
    // would re-run it and yank focus back to the first control.
    const user = userEvent.setup();

    function Rerendering() {
      const [, setTick] = useState(0);
      const ref = useRef<HTMLDivElement | null>(null);
      useDialog({ containerRef: ref, onClose: () => {} });
      return (
        <div ref={ref} role="dialog">
          <button>first</button>
          <input aria-label="field" onChange={() => setTick((t) => t + 1)} />
        </div>
      );
    }

    render(<Rerendering />);
    const field = screen.getByLabelText("field");
    field.focus();
    await user.type(field, "abc");

    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe("abc");
  });

  it("only closes once even if Escape is held down", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    function Fixed() {
      const ref = useRef<HTMLDivElement | null>(null);
      useDialog({ containerRef: ref, onClose });
      return (
        <div ref={ref} role="dialog">
          <button>first</button>
        </div>
      );
    }

    render(<Fixed />);
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
