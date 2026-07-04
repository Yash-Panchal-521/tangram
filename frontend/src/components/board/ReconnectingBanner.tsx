export function ReconnectingBanner() {
  return (
    <div className="flex items-center gap-2 px-5 py-2 bg-warn text-bg text-[13px] font-medium shrink-0">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="animate-spin shrink-0">
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
