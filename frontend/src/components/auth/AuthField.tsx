/**
 * A labelled field for the two auth forms.
 *
 * The forms were placeholder-only, which fails S5.6 and is worse than it looks:
 * a placeholder disappears the moment you type, so the one field where you most
 * need to know what is being asked -- the password, with its requirement -- loses
 * its label exactly when you start meeting it.
 */
export function AuthField({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wider text-text-dim"
      >
        {label}
      </label>
      {children}
      {hint}
    </div>
  );
}

/**
 * One password rule, ticked live. Shown from the start rather than after a
 * rejection: the requirement is knowable up front, so making someone submit to
 * discover it is a round trip that exists only because the UI stayed quiet.
 */
export function PasswordRule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-center gap-1.5 text-[11px] ${met ? "text-success" : "text-text-dim"}`}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        {met ? (
          <path
            d="M2 6.2L4.6 8.8L10 3.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        )}
      </svg>
      {children}
      {/* The icon is decorative, so the state has to reach a screen reader some
          other way -- otherwise both states read identically. */}
      <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
    </p>
  );
}
