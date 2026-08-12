import { describe, expect, it } from "vitest";
import { columnNamesProblem, MAX_COLUMNS, parseColumnNames } from "@/lib/columnNames";

describe("parseColumnNames", () => {
  it("splits on commas and trims", () => {
    expect(parseColumnNames("To Do, In Progress ,Done")).toEqual(["To Do", "In Progress", "Done"]);
  });

  it("survives the trailing comma everybody types", () => {
    expect(parseColumnNames("To Do, Done,")).toEqual(["To Do", "Done"]);
  });

  it("ignores doubled commas rather than making a nameless column", () => {
    expect(parseColumnNames("To Do,, Done")).toEqual(["To Do", "Done"]);
  });

  it("collapses runs of space inside a name", () => {
    expect(parseColumnNames("In    Progress")).toEqual(["In Progress"]);
  });

  it("drops a repeat, ignoring case", () => {
    // Two columns called "Done" and "done" are indistinguishable on a board,
    // and someone typing a list is likelier to have repeated themselves than
    // to have meant both.
    expect(parseColumnNames("Done, To Do, done")).toEqual(["Done", "To Do"]);
  });

  it("keeps the order they were written in", () => {
    // The order is the workflow — it is the one thing a comma-separated list
    // carries that a set of checkboxes would not.
    expect(parseColumnNames("Ideas, Drafting, Editing, Published")).toEqual([
      "Ideas",
      "Drafting",
      "Editing",
      "Published",
    ]);
  });

  it("reads an empty or comma-only string as nothing at all", () => {
    expect(parseColumnNames("")).toEqual([]);
    expect(parseColumnNames("  ,, , ")).toEqual([]);
  });
});

describe("columnNamesProblem", () => {
  it("asks for at least one", () => {
    expect(columnNamesProblem([])).toBe("Name at least one column.");
  });

  it("says so before the server has to", () => {
    const many = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `C${i}`);

    expect(columnNamesProblem(many)).toContain(`${MAX_COLUMNS} is the most`);
  });

  it("allows exactly the ceiling", () => {
    const exact = Array.from({ length: MAX_COLUMNS }, (_, i) => `C${i}`);

    expect(columnNamesProblem(exact)).toBeNull();
  });
});
