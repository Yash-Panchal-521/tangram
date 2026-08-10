export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  columns: string[];
}

/**
 * Starting shapes offered during the welcome flow.
 *
 * Presented as one-click choices rather than a free-form "name your columns"
 * field, deliberately: someone who has not seen the product yet cannot design
 * their own workflow, and asking them to is the kind of mandatory step that
 * turns a setup screen into an obstacle. Columns can be renamed, added and
 * removed freely afterwards — this only decides what the board looks like in
 * the first ten seconds.
 */
export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "basic",
    name: "Basic",
    description: "Three stages. Good for almost anything.",
    columns: ["To Do", "In Progress", "Done"],
  },
  {
    id: "scrum",
    name: "Sprint",
    description: "Adds a backlog and a review step.",
    columns: ["Backlog", "In Progress", "Review", "Done"],
  },
  {
    id: "content",
    name: "Content",
    description: "For things that get written, edited and published.",
    columns: ["Ideas", "Drafting", "Editing", "Published"],
  },
];

export const DEFAULT_TEMPLATE = BOARD_TEMPLATES[0];

/**
 * "Ada's workspace" reads like a real place; "My Workspace" reads like a
 * placeholder nobody chose — which is what every account got before this.
 * Falls back when there is no name to build from.
 */
export function suggestedWorkspaceName(displayName: string | null | undefined): string {
  const first = displayName?.trim().split(/\s+/)[0];
  if (!first) return "My workspace";
  // Names already ending in s take a bare apostrophe.
  return first.endsWith("s") ? `${first}' workspace` : `${first}'s workspace`;
}
