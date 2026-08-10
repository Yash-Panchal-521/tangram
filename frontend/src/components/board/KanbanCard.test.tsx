// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KanbanCard } from "@/components/board/KanbanCard";

afterEach(cleanup);

const day = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
};

describe("KanbanCard — content", () => {
  it("clamps the title and description so one long card can't push a column out of view", () => {
    render(<KanbanCard card={{ title: "A title", description: "A description" }} />);

    expect(screen.getByText("A title").className).toContain("line-clamp-3");
    expect(screen.getByText("A description").className).toContain("line-clamp-2");
  });

  it("omits the description entirely when there isn't one", () => {
    render(<KanbanCard card={{ title: "Bare", description: null }} />);

    expect(screen.getByText("Bare")).toBeTruthy();
    expect(screen.queryByText(/description/i)).toBeNull();
  });
});

describe("KanbanCard — drag affordance", () => {
  it("shows a grip only when the card is draggable", () => {
    const { container, rerender } = render(
      <KanbanCard card={{ title: "T", description: null }} draggable={false} />
    );
    expect(container.querySelector("span[aria-hidden='true'] svg")).toBeNull();

    rerender(<KanbanCard card={{ title: "T", description: null }} draggable />);
    expect(container.querySelector("span[aria-hidden='true'] svg")).not.toBeNull();
  });

  it("keeps the grip hidden until hover or focus", () => {
    const { container } = render(
      <KanbanCard card={{ title: "T", description: null }} draggable />
    );

    const grip = container.querySelector("span[aria-hidden='true']") as HTMLElement;
    // A cursor change is invisible until you're already over the card, and
    // useless to a keyboard user -- hence group-focus-visible as well.
    expect(grip.className).toContain("opacity-0");
    expect(grip.className).toContain("group-hover:opacity-100");
    expect(grip.className).toContain("group-focus-visible:opacity-100");
  });

  it("reserves room for the grip so it never sits on top of the title", () => {
    render(<KanbanCard card={{ title: "T", description: null }} draggable />);
    expect(screen.getByText("T").className).toContain("pr-5");
  });
});

describe("KanbanCard — due dates", () => {
  it("says the due status in words, not only in colour", () => {
    render(<KanbanCard card={{ title: "T", description: null, dueAt: day(-2) }} />);

    // Colour alone excludes anyone who can't distinguish the danger token from
    // the warning one.
    expect(screen.getByText("2d late")).toBeTruthy();
  });

  it("tones overdue, today and later differently", () => {
    const { container: overdue } = render(
      <KanbanCard card={{ title: "T", description: null, dueAt: day(-1) }} />
    );
    expect(overdue.querySelector("span.rounded-full")!.className).toContain("text-danger");
    cleanup();

    const { container: today } = render(
      <KanbanCard card={{ title: "T", description: null, dueAt: day(0) }} />
    );
    expect(today.querySelector("span.rounded-full")!.className).toContain("text-warn");
    cleanup();

    const { container: later } = render(
      <KanbanCard card={{ title: "T", description: null, dueAt: day(9) }} />
    );
    const cls = later.querySelector("span.rounded-full")!.className;
    expect(cls).not.toContain("text-danger");
    expect(cls).not.toContain("text-warn");
  });

  it("shows no due badge when the card has no date", () => {
    const { container } = render(<KanbanCard card={{ title: "T", description: null }} />);
    expect(container.querySelector("span.rounded-full")).toBeNull();
  });
});

describe("KanbanCard — assignee", () => {
  it("shows an avatar once a name resolves", () => {
    render(
      <KanbanCard
        card={{ title: "T", description: null, assigneeId: "u-1" }}
        assigneeName="Sara R."
      />
    );

    expect(screen.getByText("SR")).toBeTruthy();
  });

  it("reads as unassigned when the id no longer resolves to anyone", () => {
    // Someone who has left the workspace isn't in the roster, and a blank
    // avatar nobody can identify is worse than none.
    const { container } = render(
      <KanbanCard card={{ title: "T", description: null, assigneeId: "gone" }} assigneeName={null} />
    );

    expect(container.textContent).toBe("T");
  });
});

describe("KanbanCard — pending", () => {
  it("marks an in-flight card as on its way rather than pretending it exists", () => {
    render(<KanbanCard card={{ title: "New", description: null }} pending />);

    expect(screen.getByText("Adding…")).toBeTruthy();
  });
});
