"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KanbanCard } from "@/components/board/KanbanCard";
import type { CardResponse } from "@/lib/api";

export function SortableKanbanCard({
  card,
  canDrag,
  tourAnchor = false,
  assigneeName = null,
  onClick,
}: {
  card: CardResponse;
  canDrag: boolean;
  /** Marks this as the card the walkthrough points at. Exactly one board-wide. */
  tourAnchor?: boolean;
  assigneeName?: string | null;
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
      data-tour={tourAnchor ? "card" : undefined}
      className={isDragging ? "opacity-40" : undefined}
    >
      {/* A real <button>, not a div with onClick, so the card is tabbable and
          Enter opens it (S5.1). That is also what makes keyboard drag possible:
          the KeyboardSensor claims Space and preventDefaults it, so Space never
          reaches the button's implicit click -- one element, two verbs, no
          separate grab handle to hunt for. See DRAG_KEYS in BoardView. */}
      <button
        type="button"
        onClick={onClick}
        {...dragProps}
        className={`group block w-full text-left rounded-[8px] ${
          canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        }`}
      >
        <KanbanCard card={card} draggable={canDrag} assigneeName={assigneeName} />
      </button>
    </div>
  );
}
