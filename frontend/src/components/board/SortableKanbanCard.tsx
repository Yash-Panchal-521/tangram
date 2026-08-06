"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KanbanCard } from "@/components/board/KanbanCard";
import type { CardResponse } from "@/lib/api";

export function SortableKanbanCard({
  card,
  canDrag,
  onClick,
}: {
  card: CardResponse;
  canDrag: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !canDrag,
  });

  // Viewers keep the click-to-open behaviour but get no drag affordance at all:
  // the listeners and the draggable ARIA attributes are left off entirely, so
  // the card doesn't announce itself as movable or show a grab cursor for
  // something the server would reject.
  const dragProps = canDrag ? { ...attributes, ...listeners } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...dragProps}
      onClick={onClick}
      className={isDragging ? "opacity-40" : undefined}
    >
      <KanbanCard card={card} />
    </div>
  );
}
