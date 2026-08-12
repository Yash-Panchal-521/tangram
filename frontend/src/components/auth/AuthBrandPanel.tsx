import { TangramMark } from "@/components/ui/TangramMark";

// "Offline-tolerant sync" used to be the third line, and it was not true: the
// app reconnects and replays the operations it missed, but it does not queue
// edits made while offline. Either build the queue or stop claiming it -- and
// the honest version describes something more impressive anyway, because
// catching up by sequence number is the part that's actually hard.
const FEATURES = [
  "Real-time cursor presence",
  "Owner / Editor / Viewer RBAC",
  "Replays what you missed on reconnect",
];

/**
 * The left-hand marketing panel shared by /login and /signup. Extracted so the
 * two pages can't drift apart visually.
 *
 * Everything on it is `--accent-fg`, never white. The panel is painted in
 * `--accent`, and once palettes became switchable that stopped being reliably
 * dark: Graphite's dark accent is #ededed, where white text measured 1.17:1 —
 * invisible. Every dark palette failed, between 1.17 and 3.45. `--accent-fg`
 * exists for exactly this question and answers it correctly in all twelve,
 * because it is chosen per palette rather than assumed.
 */
export function AuthBrandPanel({ headline, subhead }: { headline: React.ReactNode; subhead: string }) {
  return (
    <div className="w-[420px] shrink-0 bg-accent relative hidden md:flex flex-col py-11 px-12 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--accent-fg) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="absolute -right-11 -bottom-6 opacity-[0.07] pointer-events-none">
        <TangramMark size={380} color="var(--accent-fg)" />
      </div>

      <div className="flex items-center gap-2.5 relative shrink-0">
        <div className="w-8 h-8 rounded-lg bg-accent-fg/20 flex items-center justify-center shrink-0">
          <TangramMark size={18} color="var(--accent-fg)" />
        </div>
        <span className="text-base font-semibold text-accent-fg tracking-tight">Tangram</span>
      </div>

      <div className="flex-1 flex flex-col justify-center relative py-10">
        <h1 className="text-4xl font-semibold text-accent-fg tracking-tight leading-[1.05] mb-4">{headline}</h1>
        <p className="text-[13px] text-accent-fg/70 leading-relaxed mb-9">{subhead}</p>
        <div className="flex flex-col gap-3">
          {FEATURES.map((line) => (
            <div key={line} className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-accent-fg/20 flex items-center justify-center shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path
                    d="M1.5 5L3.8 7.5L8.5 2.5"
                    stroke="var(--accent-fg)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="text-[13px] text-accent-fg/85">{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
