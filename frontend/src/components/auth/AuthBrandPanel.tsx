// Three, not a bulleted list of sentences (v7). The old panel argued its case in
// full lines with tick marks, which is a landing page's job. Naming the three
// things and stopping is the more confident version, and it leaves the headline
// carrying the weight instead of competing with nine words below it.
//
// "Offline-tolerant sync" was a fourth claim here once and it was not true: the
// app reconnects and replays what it missed, but it does not queue edits made
// offline. Replaced then, and worth not reintroducing.
const CAPABILITIES = ["Realtime", "Roles", "WIP limits"];

/**
 * The accent-filled panel shared by /login and /signup.
 *
 * Everything on it is `--accent-fg`, never white. The panel is painted in
 * `--accent`, and once palettes became switchable that stopped being reliably
 * dark — a near-white accent made white text 1.17:1, invisible. `--accent-fg`
 * exists for exactly this question and is chosen per palette rather than assumed
 * (S1.2f).
 *
 * The circles are drawn in the foreground colour at low alpha rather than in a
 * fixed white, for the same reason.
 */
export function AuthBrandPanel({ headline, subhead }: { headline: React.ReactNode; subhead: string }) {
  return (
    <div className="hidden md:flex shrink-0 basis-[46%] bg-accent relative flex-col justify-between py-13 px-12 overflow-hidden">
      {/* Two rings, mostly off-canvas. They give the panel depth without a
          gradient or an image, and they scale with the panel rather than being
          a fixed asset that crops badly. */}
      <div
        className="absolute -right-24 -bottom-20 w-[340px] h-[340px] rounded-full pointer-events-none"
        style={{ border: "1px solid color-mix(in srgb, var(--accent-fg) 16%, transparent)" }}
      />
      <div
        className="absolute right-2 bottom-14 w-[200px] h-[200px] rounded-full pointer-events-none"
        style={{ border: "1px solid color-mix(in srgb, var(--accent-fg) 12%, transparent)" }}
      />

      <span
        className="relative text-[21px] font-semibold text-accent-fg tracking-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Tangram
      </span>

      <div className="relative max-w-[430px]">
        <h1
          className="text-[44px] font-semibold text-accent-fg leading-[1.1] tracking-[-0.015em] m-0"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {headline}
        </h1>
        <p className="mt-6 max-w-[350px] text-sm leading-[1.7] text-accent-fg/70">{subhead}</p>
      </div>

      <div className="relative flex gap-7 text-[10px] uppercase tracking-[0.12em] text-accent-fg/60">
        {CAPABILITIES.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
    </div>
  );
}
