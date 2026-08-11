import { PRIORITY_LOOK } from "@/lib/priority";
import type { CardPriority } from "@/lib/api";

/**
 * The chevron that says how urgent a card is.
 *
 * Direction does the work — up for urgent, down for relaxed, a bar for the
 * middle — with colour reinforcing rather than carrying it. Doubling the
 * chevron separates Highest from High and Lowest from Low, so the five levels
 * stay distinguishable without relying on five shades.
 */
export function PriorityIcon({
  priority,
  size = 12,
  className,
}: {
  priority: CardPriority;
  size?: number;
  className?: string;
}) {
  const look = PRIORITY_LOOK[priority];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      role="img"
      aria-label={`${priority} priority`}
      className={`${look.className} ${className ?? ""} shrink-0`}
    >
      {look.direction === "flat" ? (
        <>
          <path d="M2 4.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M2 7.5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : look.direction === "up" ? (
        <>
          <path
            d={look.double ? "M2 6.5l4-3.5 4 3.5" : "M2 8l4-3.5 4 3.5"}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {look.double && (
            <path
              d="M2 9.5l4-3.5 4 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      ) : (
        <>
          <path
            d={look.double ? "M2 5.5l4 3.5 4-3.5" : "M2 4l4 3.5 4-3.5"}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {look.double && (
            <path
              d="M2 2.5l4 3.5 4-3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      )}
    </svg>
  );
}
