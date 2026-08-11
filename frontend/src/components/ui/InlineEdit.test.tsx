// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineEdit } from "@/components/ui/InlineEdit";

afterEach(cleanup);

function mount(props: Partial<Parameters<typeof InlineEdit>[0]> = {}) {
  const onCommit = vi.fn(async () => {});
  render(<InlineEdit label="Summary" value="Ship the thing" onCommit={onCommit} {...props} />);
  return { onCommit };
}

const readView = () => screen.getByRole("button", { name: /Summary/ });

describe("InlineEdit — reading", () => {
  it("shows the value as a real button, not text with a click handler (S5.1)", () => {
    mount();

    const view = readView();
    expect(view.tagName).toBe("BUTTON");
    expect(view.textContent).toBe("Ship the thing");
  });

  it("names the placeholder when there is no value", () => {
    mount({ value: "", placeholder: "Add a description…" });

    expect(screen.getByRole("button", { name: /Summary/ }).textContent).toBe("Add a description…");
  });

  it("can render the value however the caller wants", () => {
    mount({ renderValue: (v) => <strong>{v.toUpperCase()}</strong> });

    expect(screen.getByText("SHIP THE THING")).toBeTruthy();
  });
});

describe("InlineEdit — editing", () => {
  it("opens on click and puts the caret at the end, not selecting everything", async () => {
    // Select-all makes the first keystroke destroy the value, which is wrong
    // when editing an existing one is usually an amendment.
    const user = userEvent.setup();
    mount();

    await user.click(readView());

    const field = screen.getByRole("textbox", { name: "Summary" }) as HTMLInputElement;
    expect(field.value).toBe("Ship the thing");
    expect(field.selectionStart).toBe("Ship the thing".length);
  });

  it("opens from the keyboard too", async () => {
    const user = userEvent.setup();
    mount();

    readView().focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", { name: "Summary" })).toBeTruthy();
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(readView());
    await user.keyboard(" now{Enter}");

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Ship the thing now"));
  });

  it("commits on blur", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(readView());
    await user.keyboard("!");
    await user.tab();

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Ship the thing!"));
  });

  it("reverts on Escape without saving", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(readView());
    await user.keyboard(" scrapped{Escape}");

    expect(onCommit).not.toHaveBeenCalled();
    expect(readView().textContent).toBe("Ship the thing");
  });

  it("keeps Escape to itself, so a dialog above stays open (S5.3)", async () => {
    // Both this and any surrounding dialog would otherwise act on one keypress,
    // closing the thing the user was editing inside.
    const user = userEvent.setup();
    const onOuterEscape = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onOuterEscape()}>
        <InlineEdit label="Nested" value="x" onCommit={async () => {}} />
      </div>
    );

    await user.click(screen.getByRole("button", { name: /Nested/ }));
    await user.keyboard("{Escape}");

    expect(onOuterEscape).not.toHaveBeenCalled();
  });

  it("does not save when nothing actually changed", async () => {
    // A click that opens and blurs is not an edit, and a no-op write would
    // broadcast to everyone on the board for nothing.
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(readView());
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("trims before comparing, so whitespace alone is not an edit", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount();

    await user.click(readView());
    await user.keyboard("   {Enter}");

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("InlineEdit — failure", () => {
  it("reverts and says why, next to the field (S3.6)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn(async () => {
      throw new Error("Couldn't save that — check your connection.");
    });
    render(<InlineEdit label="Summary" value="Ship the thing" onCommit={onCommit} />);

    await user.click(screen.getByRole("button", { name: /Summary/ }));
    await user.keyboard("!{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("check your connection");
    // Reverted, so what is on screen is what the server actually holds.
    expect(screen.getByRole("button", { name: /Summary/ }).textContent).toBe("Ship the thing");
  });
});

describe("InlineEdit — multiline", () => {
  it("uses a textarea and lets Enter make a new line", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ multiline: true, value: "Line one" });

    await user.click(readView());
    await user.keyboard("{Enter}two");

    expect(onCommit).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Summary" }) as HTMLTextAreaElement).value).toBe(
      "Line one\ntwo"
    );
  });

  it("commits on the shortcut instead", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ multiline: true, value: "Line one" });

    await user.click(readView());
    await user.keyboard("{Enter}two");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Line one\ntwo"));
  });

  it("does NOT commit on blur, unlike a single-line field", async () => {
    // A stray click outside a half-written paragraph would overwrite the
    // previous one, and with undo gone that is unrecoverable. One line is cheap
    // to retype; several are not.
    const user = userEvent.setup();
    const { onCommit } = mount({ multiline: true, value: "Line one" });

    await user.click(readView());
    await user.keyboard(" edited");
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("offers explicit Save and Cancel", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ multiline: true, value: "Line one" });

    await user.click(readView());
    await user.keyboard(" edited");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("Line one edited"));
  });

  it("throws the edit away on Cancel", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ multiline: true, value: "Line one" });

    await user.click(readView());
    await user.keyboard(" edited");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(readView().textContent).toBe("Line one");
  });
});

describe("InlineEdit — read-only", () => {
  it("removes the affordance rather than disabling it (S8.1)", async () => {
    const user = userEvent.setup();
    const { onCommit } = mount({ readOnly: true });

    // For a viewer the truth is "not you", not "not right now" — so there is no
    // control at all, not a greyed-out one.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Ship the thing")).toBeTruthy();

    await user.click(screen.getByText("Ship the thing"));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("InlineEdit — live updates", () => {
  it("takes a new value from outside while idle", async () => {
    const { rerender } = render(
      <InlineEdit label="Summary" value="Ship the thing" onCommit={async () => {}} />
    );

    rerender(<InlineEdit label="Summary" value="Renamed elsewhere" onCommit={async () => {}} />);

    expect(screen.getByRole("button", { name: /Summary/ }).textContent).toBe("Renamed elsewhere");
  });

  it("does not overwrite what someone is part-way through typing", async () => {
    // Someone else's broadcast must not yank the field out from under a person
    // mid-sentence.
    const user = userEvent.setup();
    const { rerender } = render(
      <InlineEdit label="Summary" value="Ship the thing" onCommit={async () => {}} />
    );

    await user.click(screen.getByRole("button", { name: /Summary/ }));
    await user.keyboard(" and more");

    rerender(<InlineEdit label="Summary" value="Renamed elsewhere" onCommit={async () => {}} />);

    expect((screen.getByRole("textbox", { name: "Summary" }) as HTMLInputElement).value).toBe(
      "Ship the thing and more"
    );
  });
});
