"use client";

/**
 * One row of the context column: label on the left, value on the right.
 *
 * A row, not a stacked label-above-field group. Jira's right column is scannable
 * because the labels form a single vertical edge you read down, and the values
 * form another — stacking them doubles the height and destroys that. The rest of
 * this app stacks (see `Input`), so this is a deliberate local departure rather
 * than an oversight.
 */
export function ContextRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** Omitted when the value is plain text, so no label points at nothing. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const text = (
    <span className="text-[11px] font-medium text-text-muted pt-1.5 shrink-0 w-[76px]">
      {label}
    </span>
  );

  return (
    <div className="flex items-start gap-2">
      {htmlFor ? <label htmlFor={htmlFor}>{text}</label> : text}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
