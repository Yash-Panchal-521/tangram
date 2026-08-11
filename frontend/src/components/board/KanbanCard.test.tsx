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

describe("KanbanCard — priority", () => {
  it("shows the priority without needing the card opened", () => {
    // The point of putting it on the face: urgency should be readable while
    // scanning a column, not one click away.
    render(<KanbanCard card={{ title: "Urgent", description: null, priority: "Highest" }} />);

    expect(screen.getByRole("img", { name: "Highest priority" })).toBeTruthy();
  });

  it("says the level in words, not only in shape and colour", () => {
    // Five levels rendered as chevrons are indistinguishable to a screen
    // reader, and the two urgent ones share a colour with each other.
    render(<KanbanCard card={{ title: "Low", description: null, priority: "Lowest" }} />);

    expect(screen.getByLabelText("Lowest priority")).toBeTruthy();
  });

  it("shows nothing when nobody has set one", () => {
    render(<KanbanCard card={{ title: "Plain", description: null, priority: null }} />);

    expect(screen.queryByRole("img", { name: /priority/ })).toBeNull();
  });

  it("puts priority before the due date", () => {
    // Urgency changes whether you care about the deadline, so it is read first.
    const { container } = render(
      <KanbanCard card={{ title: "Both", description: null, priority: "High", dueAt: day(3) }} />
    );

    const row = container.querySelector(".items-center.gap-2")!;
    const icon = screen.getByRole("img", { name: "High priority" });
    const due = screen.getByText("in 3d");
    expect(row.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(icon.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives the five levels distinguishable shapes, not just colours", () => {
    // Someone who cannot separate red from grey still has to tell Highest from
    // High, and Low from Lowest — so direction and doubling carry it.
    const shapes = (["Highest", "High", "Medium", "Low", "Lowest"] as const).map((p) => {
      cleanup();
      const { container } = render(
        <KanbanCard card={{ title: p, description: null, priority: p }} />
      );
      const svg = container.querySelector('[role="img"]')!;
      return svg.innerHTML;
    });

    expect(new Set(shapes).size).toBe(5);
  });
});

describe("KanbanCard — comments", () => {
  it("shows how many there are", () => {
    render(<KanbanCard card={{ title: "Discussed", description: null, commentCount: 3 }} />);

    expect(screen.getByText("3")).toBeTruthy();
  });

  it("says nothing when there are none", () => {
    // A "0" on every card would be noise on the row where width is scarcest,
    // and the missing icon already carries the same information.
    const { container } = render(
      <KanbanCard card={{ title: "Quiet", description: null, commentCount: 0 }} />
    );

    expect(container.textContent).not.toContain("0");
  });

  it("counts in words too, for anyone who never sees the speech bubble", () => {
    render(<KanbanCard card={{ title: "Discussed", description: null, commentCount: 2 }} />);

    // The number alone reads as a quantity of nothing in particular.
    expect(screen.getByText(/comments/)).toBeTruthy();
  });
});
