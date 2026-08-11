"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CardDetailModal } from "@/components/board/detail/CardDetailModal";
import type {
  CardResponse,
  CommentResponse,
  LabelResponse,
  MemberResponse,
  UpdateCardRequest,
} from "@/lib/api";

// Here because the modal is otherwise unreachable without signing in and
// opening a board, which makes it the one surface nobody can eyeball. The board
// skeleton earned its place here for the same reason, after drifting a whole
// feature behind the header it imitates.
const MEMBERS: MemberResponse[] = [
  { userId: "u-2", displayName: "Sara Reyes", email: "sara@example.com", role: "Editor" },
  { userId: "u-3", displayName: "Dev Patel", email: "dev@example.com", role: "Owner" },
];

const STATUSES = [
  { id: "col-todo", name: "To Do" },
  { id: "col-doing", name: "In Progress" },
  { id: "col-review", name: "Review" },
  { id: "col-done", name: "Done" },
];

export function CardDetailDemo() {
  const [open, setOpen] = useState<"editor" | "viewer" | null>(null);
  const [labels, setLabels] = useState<LabelResponse[]>([
    { id: "l-1", name: "Design system", color: "purple" },
    { id: "l-2", name: "Bug", color: "red" },
    { id: "l-3", name: "Chore", color: "grey" },
  ]);
  const [card, setCard] = useState<CardResponse>({
    id: "demo-card",
    columnId: "col-doing",
    title: "Replace the native date input",
    description:
      "The browser's calendar takes none of the app's tokens, so it was the one control that ignored dark mode.\n\nMost due dates are today, tomorrow or next week — name those and they cost one click each.",
    rank: "a0",
    dueAt: null,
    assigneeId: "u-2",
    createdAt: "2026-08-01T09:12:00.000Z",
    updatedAt: "2026-08-09T16:40:00.000Z",
    priority: "High",
    labels: [
      { id: "l-1", name: "Design system", color: "purple" },
      { id: "l-2", name: "Bug", color: "red" },
    ],
    commentCount: 2,
  });

  // Lazy, because `Date.now()` during render is a different value every time
  // React re-renders — which is exactly what the purity rule is protecting.
  const [comments, setComments] = useState<CommentResponse[]>(() => [
    {
      id: "c-1", cardId: "demo-card", authorId: "u-2", authorName: "Sara Reyes",
      body: "The quick picks are the bit that sold me — most due dates really are just tomorrow.",
      createdAt: new Date(Date.now() - 7_200_000).toISOString(), editedAt: null,
    },
    {
      id: "c-2", cardId: "demo-card", authorId: "u-me", authorName: "You",
      body: "Agreed. Kept the grid because a real date still has to be reachable.",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      editedAt: new Date(Date.now() - 3_000_000).toISOString(),
    },
  ]);

  // Applies locally so the demo behaves, with the same merge rule the board
  // uses: a clear flag wins, an omitted field is left alone.
  async function commit(update: UpdateCardRequest) {
    setCard((c) => ({
      ...c,
      title: update.title ?? c.title,
      description: update.description !== undefined ? update.description : c.description,
      dueAt: update.clearDueAt ? null : update.dueAt ?? c.dueAt,
      assigneeId: update.clearAssignee ? null : update.assigneeId ?? c.assigneeId,
      priority: update.clearPriority ? null : update.priority ?? c.priority,
      labels: update.labelIds
        ? update.labelIds
            .map((id) => labels.find((l) => l.id === id))
            .filter((l): l is LabelResponse => l !== undefined)
        : c.labels,
      updatedAt: new Date().toISOString(),
    }));
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button size="sm" onClick={() => setOpen("editor")}>
        Open as editor
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen("viewer")}>
        Open as viewer
      </Button>

      {open && (
        <CardDetailModal
          card={card}
          readOnly={open === "viewer"}
          members={MEMBERS}
          statuses={STATUSES}
          onClose={() => setOpen(null)}
          onCommit={commit}
          onMove={async (targetColumnId) => setCard((c) => ({ ...c, columnId: targetColumnId }))}
          onDelete={async () => setOpen(null)}
          labels={labels}
          onCreateLabel={async (name, color) =>
            setLabels((ls) => [...ls, { id: `l-${ls.length + 1}-${name}`, name, color }])
          }
          comments={{
            items: comments,
            loading: false,
            error: null,
            // "u-me" owns the second comment, so edit and delete are reachable
            // on one row and absent on the other.
            currentUserId: "u-me",
            onAdd: async (body) =>
              setComments((cs) => [
                ...cs,
                {
                  id: `c-${cs.length + 1}`, cardId: "demo-card", authorId: "u-me",
                  authorName: "You", body, createdAt: new Date().toISOString(), editedAt: null,
                },
              ]),
            onEdit: async (id, body) =>
              setComments((cs) =>
                cs.map((c) => (c.id === id ? { ...c, body, editedAt: new Date().toISOString() } : c))
              ),
            onDelete: async (id) => setComments((cs) => cs.filter((c) => c.id !== id)),
            onRetry: () => {},
          }}
          onDeleteLabel={async (labelId) => {
            setLabels((ls) => ls.filter((l) => l.id !== labelId));
            setCard((c) => ({ ...c, labels: c.labels.filter((l) => l.id !== labelId) }));
          }}
        />
      )}
    </div>
  );
}
