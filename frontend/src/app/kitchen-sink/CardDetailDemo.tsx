"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CardDetailModal } from "@/components/board/detail/CardDetailModal";
import type { CardResponse, MemberResponse, UpdateCardRequest } from "@/lib/api";

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
  });

  // Applies locally so the demo behaves, with the same merge rule the board
  // uses: a clear flag wins, an omitted field is left alone.
  async function commit(update: UpdateCardRequest) {
    setCard((c) => ({
      ...c,
      title: update.title ?? c.title,
      description: update.description !== undefined ? update.description : c.description,
      dueAt: update.clearDueAt ? null : update.dueAt ?? c.dueAt,
      assigneeId: update.clearAssignee ? null : update.assigneeId ?? c.assigneeId,
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
        />
      )}
    </div>
  );
}
