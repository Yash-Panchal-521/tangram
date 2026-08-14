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
  labelHint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  /**
   * Sits opposite the label, on the same baseline (v7).
   *
   * For a rule you need *before* typing — the password minimum — rather than
   * after being rejected for it. Below the field it reads as feedback on what
   * you just entered; beside the label it reads as part of the question.
   */
  labelHint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3">
        {/* 10px at 0.12em (v7). The micro-label is the design's recurring device
            — it names a field without competing with its value, which is what
            lets the underline inputs stay unboxed and still read as fields. */}
        <label
          htmlFor={id}
          className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-dim"
        >
          {label}
        </label>
        {labelHint && <span className="text-[12px] text-text-dim shrink-0">{labelHint}</span>}
      </span>
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
