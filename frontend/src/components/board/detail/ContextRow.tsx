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
    <span className="text-[11px] font-medium text-text-muted leading-[26px]">{label}</span>
  );

  // A grid, not a flex row with a width on the label.
  //
  // The width used to sit on this span, which is inline — and width does not
  // apply to inline boxes, so it was silently ignored and every label sized to
  // its own text. Status, Assignee and Due each started their control at a
  // different x, which is exactly the ragged edge the column is supposed to
  // avoid. A grid track cannot be ignored the same way, and it holds whether the
  // label is wrapped in a <label> or not.
  return (
    <div className="grid grid-cols-[72px_1fr] items-start gap-x-2.5">
      {htmlFor ? <label htmlFor={htmlFor}>{text}</label> : text}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
