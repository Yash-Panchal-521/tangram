export function TangramMark({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect x="1" y="3" width="9" height="30" rx="2.5" fill={color} />
      <rect x="13.5" y="3" width="9" height="30" rx="2.5" fill={color} />
      <rect x="26" y="3" width="9" height="30" rx="2.5" fill={color} />
    </svg>
  );
}
