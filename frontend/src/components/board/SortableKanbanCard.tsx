"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KanbanCard } from "@/components/board/KanbanCard";
import type { CardResponse } from "@/lib/api";

export function SortableKanbanCard({
  card,
  onClick,
}: {
  card: CardResponse;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={isDragging ? "opacity-40" : undefined}
    >
      <KanbanCard card={card} />
    </div>
  );
}
