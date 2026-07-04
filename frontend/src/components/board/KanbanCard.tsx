import type { CardResponse } from "@/lib/api";

export function KanbanCard({ card }: { card: CardResponse }) {
  return (
    <div className="bg-surface border border-border rounded-[8px] p-3.5 flex flex-col gap-2 transition-shadow hover:shadow-[0_3px_14px_rgba(0,0,0,0.08)] hover:border-border-2">
      <p className="text-[13px] font-medium leading-snug">{card.title}</p>
      {card.description && (
        <p className="text-xs text-text-muted leading-snug">{card.description}</p>
      )}
    </div>
  );
}
