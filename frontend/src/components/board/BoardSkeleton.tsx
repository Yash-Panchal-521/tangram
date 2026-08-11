import Link from "next/link";
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
 *
 * "For real" means the actual markup, classes and labels of anything the
 * response cannot change: the mark, the Boards crumb, and the Activity and
 * Members controls. Their widths then match by construction. The previous
 * version guessed at them with bars -- `w-16`, `w-14` -- which was already wrong
 * by two controls, because it still described the header as it stood before the
 * activity feed, the workspace home and the account menu existed. Grey bars are
 * kept for exactly what the response decides: the board's name, who is present,
 * and whose account this is.
 *
 * The one thing that can still shift is the "View only" pill, which appears once
 * the caller's role is known. Pre-drawing it would mean guessing the role, and
 * guessing wrong shifts the same header for everyone else instead.
 */
export function BoardSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden" role="status" aria-busy="true">
      <span className="sr-only">Loading board…</span>

      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Both real links. Nothing about them depends on the board, and a
              cold start can take a minute -- during which this is the only way
              out of a page that is still deciding what it is. */}
          <Link
            href="/boards"
            aria-label="All boards"
            title="All boards"
            className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0 hover:opacity-85 transition-opacity"
          >
            <TangramMark size={14} color="var(--accent-fg)" />
          </Link>
          <Link href="/boards" className="text-xs text-text-dim hover:text-text-muted shrink-0">
            Boards
          </Link>
          <span className="text-sm text-text-dim shrink-0">/</span>
          <Skeleton className="h-3.5 w-32 rounded" />
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Not a placeholder: "Connecting…" is what the real header shows
              while the socket is opening, which is exactly what is happening.
              Same dot, minus the pulse, which belongs to being connected. */}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--warn)" }} />
            <span className="text-xs whitespace-nowrap" style={{ color: "var(--warn)" }}>
              Connecting…
            </span>
          </div>

          <div className="w-px h-4.5 bg-border" />

          {/* One avatar's worth of space. How many people are here is the
              response's business; that somebody will be is not. */}
          <Skeleton className="w-6 h-6 rounded-full" />

          {/* Real icons and labels, so these occupy their exact final width --
              but inert, and without the hover and pointer affordances, so
              nothing invites a click that would do nothing. */}
          <span
            aria-hidden="true"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-text-dim whitespace-nowrap"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.75" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M7 3.9V7l2.1 1.4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Activity
          </span>

          <span
            aria-hidden="true"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-text-dim whitespace-nowrap"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="5.25" cy="4.5" r="2.25" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M1.25 11.5c0-1.8 1.79-3.25 4-3.25s4 1.45 4 3.25"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M10 2.6a2.25 2.25 0 010 3.8M11.4 8.5c1.35.42 2.35 1.6 2.35 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            Members
          </span>

          {/* The account menu's trigger is an Avatar at size sm. */}
          <Skeleton className="w-6 h-6 rounded-full" />
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
