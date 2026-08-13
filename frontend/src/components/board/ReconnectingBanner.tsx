/**
 * A board-level status, styled like the one it sits beside.
 *
 * This was `bg-warn text-bg`: `--bg` is a pale grey in light mode and `--warn` a
 * mid amber, so it was pale grey on amber at 13px, full width, across the top of
 * the board. Measured 1.84:1 in Indigo and 3.06–3.72 in the other five light
 * palettes — all six under 4.5. The free tier sleeps after fifteen minutes, so a
 * wake is the *normal* first experience rather than an edge case (S2.4); the app
 * had done the hard part of explaining the wait and then printed the explanation
 * illegibly.
 *
 * Now the surface carries the message and the amber carries the signal. That
 * passes everywhere by construction, and it makes this and the slow-load pill in
 * BoardSkeleton look like the same kind of thing — which they are, and didn't.
 */
export function ReconnectingBanner() {
  return (
    <div className="flex items-center gap-2 px-5 py-2 bg-surface-2 border-b border-warn text-text text-[13px] font-medium shrink-0">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="animate-spin shrink-0 text-warn">
        <circle
          cx="6.5"
          cy="6.5"
          r="5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeDasharray="10 8"
          strokeLinecap="round"
        />
      </svg>
      Reconnecting to workspace…
    </div>
  );
}
