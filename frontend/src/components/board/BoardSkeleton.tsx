import { Skeleton } from "@/components/ui/Skeleton";
import { TangramMark } from "@/components/ui/TangramMark";

// Fixed, not random: the same shape has to render on the bootstrap page and
// again on the board route, and a different silhouette each time would read as
// the page reloading rather than continuing.
// `true` is a card with a description, which is the taller of the two real card
// heights. Literal class strings rather than computed ones, so Tailwind's
// scanner can see them.
const COLUMNS = [[false, true, false], [true, false], [false, false, true, false]];

/**
 * The board's silhouette while it loads. Replaces a centred "Loading board…",
 * which told you nothing and then shoved the entire page aside on arrival.
 *
 * The header is the real one, not a placeholder strip -- it is 52px of chrome
 * whose position never depends on the response, so drawing it for real means the
 * only thing that changes on load is the column contents (S2.2, S6.2).
 */
export function BoardSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden" role="status" aria-busy="true">
      <span className="sr-only">Loading board…</span>

      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0">
            <TangramMark size={14} color="var(--accent-fg)" />
          </div>
          <Skeleton className="h-3.5 w-32 rounded" />
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Skeleton className="h-3 w-16 rounded" />
          <div className="w-px h-4.5 bg-border" />
          <Skeleton className="h-6.5 w-6.5 rounded-full" />
          <div className="w-px h-4.5 bg-border" />
          <Skeleton className="h-3 w-14 rounded" />
        </div>
      </header>

      <div className="flex-1 overflow-hidden px-6 py-5 relative">
        {slow && (
          // S2.4: the free-tier API sleeps after 15 minutes and takes 30-60s to
          // wake. Predictable, so the wait explains itself rather than sitting
          // there looking stuck.
          //
          // Floated rather than placed in the flow: it appears several seconds
          // in and disappears again on arrival, so in-flow it would shove the
          // columns down and then yank them back — two shifts, both against
          // S6.2. Absolute, it costs the layout nothing.
          <p className="absolute left-1/2 -translate-x-1/2 top-6 z-10 max-w-xs px-3.5 py-2 rounded-lg border border-border bg-surface shadow-sm text-xs text-text-muted text-center">
            The server sleeps when it hasn&apos;t been used for a while. Waking it takes up to a
            minute — this will continue on its own.
          </p>
        )}

        <div className="flex items-start gap-3.5 h-full">
          {COLUMNS.map((cards, i) => (
            <div key={i} className="flex-none w-[262px] h-full flex flex-col">
              <div className="flex items-center gap-2 px-0.5 pb-3 shrink-0">
                <Skeleton className="w-2 h-2 rounded-full shrink-0" />
                <Skeleton className="h-2.5 w-20 rounded" />
              </div>
              <div className="flex flex-col gap-2">
                {cards.map((tall, j) => (
                  <Skeleton
                    key={j}
                    className={tall ? "h-16 rounded-[8px]" : "h-[46px] rounded-[8px]"}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
