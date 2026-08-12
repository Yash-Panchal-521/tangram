import { Skeleton } from "@/components/ui/Skeleton";

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
 * The header is the real one, not a placeholder strip — it is 52px of chrome
 * whose position never depends on the response, so drawing it for real means the
 * only thing that changes on load is the column contents (S2.2, S6.2).
 *
 * **This has now drifted twice**, which says something about the shape of the
 * problem rather than about either change. The first time it still described the
 * header as it stood before the workspace home and the account menu existed. The
 * second time the navigation moved to the sidebar and the columns became equal-
 * width lanes, and this file kept drawing a *Boards* crumb and a *Members*
 * control that no longer exist anywhere — promising, on every board load, two
 * controls that would then vanish.
 *
 * The lesson is that "draw the real thing" only holds while somebody remembers
 * this file exists. So its test now pins the header's actual contents in both
 * directions: what must be here, and what must *not* be. A third drift should
 * fail a test rather than wait to be noticed.
 *
 * There is no navigation here at all now, and that is correct rather than an
 * omission: `AppShell` wraps this, so the sidebar — with the mark, the board
 * list and Members — is already on screen and is the way out during a cold
 * start. Drawing another would be drawing it twice.
 *
 * Two things are deliberately not pre-drawn, both for the same reason: the
 * "View only" pill and the Create button appear only once the caller's role is
 * known, and guessing a role wrong shifts the header for everyone it was
 * guessed wrong for. A gap that fills is better than a control that disappears.
 */
export function BoardSkeleton({ slow = false }: { slow?: boolean }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden" role="status" aria-busy="true">
      <span className="sr-only">Loading board…</span>

      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* The board's name is the one thing here the response decides. */}
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

          {/* The account menu's trigger is an Avatar at size sm. */}
          <Skeleton className="w-6 h-6 rounded-full" />
        </div>
      </header>

      {/* The filter bar, which is 41px of chrome that appears on arrival for
          any board with columns. Not role-dependent — a viewer filters too — so
          unlike Create it can be drawn without guessing anything. */}
      <div className="shrink-0 flex items-center gap-2 px-4.5 py-2 border-b border-border bg-surface">
        <Skeleton className="h-7 w-[200px] rounded-md" />
        <Skeleton className="h-7 w-[86px] rounded-md" />
        <Skeleton className="h-7 w-[84px] rounded-md" />
        <Skeleton className="h-7 w-[88px] rounded-md" />
        <Skeleton className="h-7 w-[120px] rounded-md" />
      </div>

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

        {/* Lanes, equal-width, matching the loaded board: `flex-1 basis-0` so
            three placeholders occupy exactly the width three real columns will,
            whatever the window. A fixed 262px was right until the columns
            started sharing the board between them. */}
        <div className="flex items-stretch gap-3 h-full">
          {COLUMNS.map((cards, i) => (
            <div
              key={i}
              className="flex-1 basis-0 min-w-[240px] h-full flex flex-col rounded-xl bg-surface-2/50 border border-border/70 p-2"
            >
              <div className="flex items-center gap-2 px-1 pb-2 shrink-0">
                {/* A bar, as the loaded column head has — the dot became one
                    because at 8px a circle is a smudge. */}
                <Skeleton className="w-1 h-3.5 rounded-full shrink-0" />
                <Skeleton className="h-2.5 w-20 rounded" />
              </div>
              <div className="flex flex-col gap-2 px-1">
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
