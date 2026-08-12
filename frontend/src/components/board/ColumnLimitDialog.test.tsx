// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnLimitDialog } from "@/components/board/ColumnLimitDialog";

afterEach(cleanup);

function mount(overrides: Partial<Parameters<typeof ColumnLimitDialog>[0]> = {}) {
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <ColumnLimitDialog
      columnName="In Progress"
      minCards={null}
      maxCards={null}
      onSave={onSave}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSave, onClose };
}

const min = () => screen.getByLabelText("Minimum") as HTMLInputElement;
const max = () => screen.getByLabelText("Maximum") as HTMLInputElement;

describe("ColumnLimitDialog", () => {
  it("starts empty when there are no limits, and empty means no limit", async () => {
    const user = userEvent.setup();
    const { onSave } = mount();

    expect(min().value).toBe("");
    expect(max().value).toBe("");

    await user.type(max(), "5");
    await user.click(screen.getByRole("button", { name: "Save limits" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        minCards: null,
        maxCards: 5,
        // Explicit, because an absent field means "leave alone" — without this
        // clearing a limit would silently do nothing.
        clearMinCards: true,
        clearMaxCards: false,
      })
    );
  });

  it("keeps a maximum of zero distinct from no maximum", async () => {
    // "Nothing should be in progress here" is a real thing to say about a
    // staging column, so 0 and "" cannot collapse into each other.
    const user = userEvent.setup();
    const { onSave } = mount();

    await user.type(max(), "0");
    await user.click(screen.getByRole("button", { name: "Save limits" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxCards: 0, clearMaxCards: false }))
    );
  });

  it("clears a limit when its field is emptied", async () => {
    const user = userEvent.setup();
    const { onSave } = mount({ minCards: 2, maxCards: 5 });

    await user.clear(max());
    await user.click(screen.getByRole("button", { name: "Save limits" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ maxCards: null, clearMaxCards: true }))
    );
  });

  it("refuses a minimum above the maximum before spending a round trip", async () => {
    const user = userEvent.setup();
    const { onSave } = mount();

    await user.type(min(), "9");
    await user.type(max(), "2");

    expect(screen.getByRole("alert").textContent).toContain("can't be more than the maximum");
    expect((screen.getByRole("button", { name: "Save limits" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cannot be given a negative number at all", async () => {
    // Stripped at the field rather than validated after: a minus sign is a
    // typo here, never a smaller limit.
    const user = userEvent.setup();
    mount();

    await user.type(max(), "-3");

    expect(max().value).toBe("3");
  });

  it("stays open and says why when the save is rejected (S3.2)", async () => {
    const user = userEvent.setup();
    const { onClose } = mount({
      onSave: vi.fn(async () => {
        throw new Error("Can't reach Tangram right now.");
      }),
    });

    await user.type(max(), "3");
    await user.click(screen.getByRole("button", { name: "Save limits" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach Tangram");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says the limit is advisory, because the word limit implies it is not", async () => {
    mount();

    expect(screen.getByText(/cards can still be moved into a full column/i)).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
