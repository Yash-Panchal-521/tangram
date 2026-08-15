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
    expect(screen.queryByText("1d late")).toBeNull();

    render(<KanbanCard card={{ title: "T", description: null, dueAt: day(-1) }} />);
    expect(screen.getByText("1d late").className).toContain("text-danger");
    cleanup();

    render(<KanbanCard card={{ title: "T", description: null, dueAt: day(0) }} />);
    expect(screen.getByText("Today").className).toContain("text-warn");
    cleanup();

    render(<KanbanCard card={{ title: "T", description: null, dueAt: day(5) }} />);
    const cls = screen.getByText("in 5d").className;
    expect(cls).not.toContain("text-danger");
    expect(cls).not.toContain("text-warn");
  });

  it("shows no due badge when the card has no date", () => {
    const { container } = render(<KanbanCard card={{ title: "T", description: null }} />);
    expect(container.textContent).toBe("T");
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
  it("states the level, so urgency is readable while scanning a column", () => {
    render(<KanbanCard card={{ title: "Urgent", description: null, priority: "Highest" }} />);

    expect(screen.getByText("Highest")).toBeTruthy();
  });

  it("keeps all five levels distinct, which two shades of red would not", () => {
    // The face used to draw chevrons and lean on direction plus doubling to
    // separate Highest from High. The word does that on its own, and survives
    // being read aloud.
    const words = (["Highest", "High", "Medium", "Low", "Lowest"] as const).map((p) => {
      cleanup();
      render(<KanbanCard card={{ title: "x", description: null, priority: p }} />);
      return screen.getByText(p).textContent;
    });

    expect(new Set(words).size).toBe(5);
  });

  it("shows nothing when nobody has set one", () => {
    const { container } = render(
      <KanbanCard card={{ title: "Plain", description: null, priority: null }} />
    );

    expect(container.textContent).toBe("Plain");
  });

  it("marks the card's edge, and leaves the space when there is no level", () => {
    // The 3px strip is always in the layout — see NO_PRIORITY_TICK. Setting a
    // priority must not shift the card's text sideways.
    const { container: withP } = render(
      <KanbanCard card={{ title: "T", description: null, priority: "High" }} />
    );
    const set = withP.firstElementChild as HTMLElement;
    expect(set.className).toContain("border-l-[3px]");
    expect(set.style.borderLeftColor).toBe("var(--danger)");
    cleanup();

    const { container: without } = render(<KanbanCard card={{ title: "T", description: null }} />);
    const unset = without.firstElementChild as HTMLElement;
    expect(unset.className).toContain("border-l-[3px]");
    expect(unset.style.borderLeftColor).toBe("transparent");
  });

  it("puts priority before the due date", () => {
    // Urgency changes whether you care about the deadline, so it is read first.
    render(
      <KanbanCard card={{ title: "Both", description: null, priority: "High", dueAt: day(3) }} />
    );

    const badge = screen.getByText("High");
    const due = screen.getByText("in 3d");
    expect(badge.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("KanbanCard — labels", () => {
  const label = { id: "l1", name: "billing", color: "red" as const };

  it("sets the name in a text token, never in the label's own hue", () => {
    // S1.2g. Hue-painted label text measured 2.15-4.49:1 and was corrected in
    // v5; this face renders smaller than the chips that failed, so painting the
    // word here would land the same defect somewhere new.
    render(<KanbanCard card={{ title: "T", description: null, labels: [label] }} />);

    const name = screen.getByText("billing");
    expect(name.parentElement!.className).toContain("text-text-muted");
    // No inline colour anywhere on the word or its wrapper — that is what the
    // corrected chip does, and what this must not undo.
    expect(name.getAttribute("style")).toBeNull();
    expect(name.parentElement!.getAttribute("style")).toBeNull();
  });

  it("still carries the hue, on a dot beside the word", () => {
    const { container } = render(
      <KanbanCard card={{ title: "T", description: null, labels: [label] }} />
    );

    const dot = container.querySelector("span[aria-hidden='true'].rounded-full") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.backgroundColor).toBeTruthy();
  });
});

describe("KanbanCard — comments", () => {
  it("counts in words, not as a number beside a speech bubble", () => {
    // The bare count read as a quantity of nothing in particular to anyone who
    // never sees the icon.
    render(<KanbanCard card={{ title: "Discussed", description: null, commentCount: 3 }} />);

    expect(screen.getByText("3 comments")).toBeTruthy();
  });

  it("says one comment in the singular", () => {
    render(<KanbanCard card={{ title: "Discussed", description: null, commentCount: 1 }} />);

    expect(screen.getByText("1 comment")).toBeTruthy();
  });

  it("says nothing when there are none", () => {
    // A "0 comments" on every card would be noise on the row where width is
    // scarcest, and the absence already carries the same information.
    const { container } = render(
      <KanbanCard card={{ title: "Quiet", description: null, commentCount: 0 }} />
    );

    expect(container.textContent).toBe("Quiet");
  });
});

describe("KanbanCard — last touched", () => {
  it("says when it last moved, which is what makes a stale card visible", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(<KanbanCard card={{ title: "T", description: null, updatedAt: twoHoursAgo }} />);

    expect(screen.getByText("2h ago")).toBeTruthy();
  });
});
