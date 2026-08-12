// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeedColumnsDialog } from "@/components/board/SeedColumnsDialog";
import { BOARD_TEMPLATES } from "@/lib/boardTemplates";

afterEach(cleanup);

function mount(overrides: Partial<Parameters<typeof SeedColumnsDialog>[0]> = {}) {
  const onCreate = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<SeedColumnsDialog onCreate={onCreate} onClose={onClose} {...overrides} />);
  return { onCreate, onClose };
}

const add = () => screen.getByRole("button", { name: "Add columns" });

describe("SeedColumnsDialog", () => {
  it("arrives with a shape already chosen, so nothing is disabled on landing", () => {
    // An empty board is the worst moment to make someone choose before
    // anything can happen.
    mount();

    // No jest-dom here, so the property rather than the matcher.
    expect((screen.getByRole("radio", { name: /Basic/ }) as HTMLInputElement).checked).toBe(
      true
    );
    expect((add() as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates a template's columns in its own order", async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = mount();

    await user.click(add());

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(BOARD_TEMPLATES[0].columns));
    expect(onClose).toHaveBeenCalled();
  });

  it("switches between shapes", async () => {
    const user = userEvent.setup();
    const { onCreate } = mount();

    await user.click(screen.getByRole("radio", { name: /Sprint/ }));
    await user.click(add());

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(BOARD_TEMPLATES.find((t) => t.id === "scrum")!.columns)
    );
  });

  it("takes a whole workflow as one comma-separated line", async () => {
    // Anyone who already knows their stages can type them faster than they can
    // click four times.
    const user = userEvent.setup();
    const { onCreate } = mount();

    await user.click(screen.getByRole("radio", { name: /Custom/ }));
    await user.type(
      screen.getByLabelText("Column names, separated by commas"),
      "Triage, Building, Shipped"
    );
    await user.click(add());

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(["Triage", "Building", "Shipped"]));
  });

  it("shows the parse back, so a trailing comma is not a silent surprise", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("radio", { name: /Custom/ }));
    const field = screen.getByLabelText("Column names, separated by commas");
    await user.type(field, "Triage, Shipped,");

    // Named to avoid colliding with the template chips above, which also say
    // "To Do". Two chips, not three — the empty tail is gone, and visibly so.
    expect(screen.getByText("Triage")).toBeTruthy();
    expect(screen.getByText("Shipped")).toBeTruthy();
    expect(screen.getByText("2 columns")).toBeTruthy();
  });

  it("stays quiet about an empty field nobody has typed in yet", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("radio", { name: /Custom/ }));

    // Telling someone their untouched field is empty is not help.
    expect(screen.queryByRole("alert")).toBeNull();
    expect((add() as HTMLButtonElement).disabled).toBe(true);
  });

  it("says the ceiling before the server has to", async () => {
    const user = userEvent.setup();
    const { onCreate } = mount();

    await user.click(screen.getByRole("radio", { name: /Custom/ }));
    await user.type(
      screen.getByLabelText("Column names, separated by commas"),
      "a,b,c,d,e,f,g,h,i"
    );

    expect(screen.getByRole("alert").textContent).toContain("8 is the most");
    expect((add() as HTMLButtonElement).disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("stays open and keeps the list when the create is rejected (S3.2)", async () => {
    const user = userEvent.setup();
    const { onClose } = mount({
      onCreate: vi.fn(async () => {
        throw new Error("Can't reach Tangram right now.");
      }),
    });

    await user.click(add());

    expect((await screen.findByRole("alert")).textContent).toContain("Can't reach Tangram");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = mount();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
