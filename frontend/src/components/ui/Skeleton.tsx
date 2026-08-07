/**
 * A single loading placeholder. Size and shape come from the caller, because a
 * skeleton's whole job is to occupy the exact space its content will (S2.2).
 *
 * Deliberately carries no default radius: `className` is appended, and appending
 * a second `rounded-*` leaves the winner to stylesheet order rather than
 * argument order (S1.3). Every caller states its own.
 *
 * `aria-hidden` because a screen reader gains nothing from three grey bars --
 * the surface wrapping these announces the wait once, via `role="status"`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-surface-2 animate-pulse ${className}`} />;
}
