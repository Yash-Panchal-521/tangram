"use client";

import { useRef } from "react";
import type { MembershipRole } from "@/lib/api";

export const INVITE_ROLES: MembershipRole[] = ["Owner", "Editor", "Viewer"];

// Deliberately permissive: the server and the mail provider are the real
// authorities on deliverability. This only catches obvious typos before we
// spend a round trip on them.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Commas, semicolons, and whitespace. Space is a *splitter* for pasted text but
// not a commit key while typing -- see onKeyDown.
const SEPARATORS = /[,;\s]+/;

export interface Recipient {
  id: string;
  email: string;
  role: MembershipRole;
}

export type RecipientStatus = "ok" | "invalid" | "self" | "member" | "invited";

export interface RecipientContext {
  myEmail: string | null;
  memberEmails: Map<string, MembershipRole>;
  invitedEmails: Map<string, MembershipRole>;
}

// Derived on every render rather than stored on the chip: a stored status goes
// stale the moment the roster reloads, leaving a chip claiming someone is
// "already a member" after they've been removed.
export function statusOf(recipient: Recipient, context: RecipientContext): RecipientStatus {
  if (!EMAIL_PATTERN.test(recipient.email)) return "invalid";
  if (context.myEmail && recipient.email === context.myEmail) return "self";
  if (context.memberEmails.has(recipient.email)) return "member";
  if (context.invitedEmails.has(recipient.email)) return "invited";
  return "ok";
}

export function statusHint(
  recipient: Recipient,
  status: RecipientStatus,
  context: RecipientContext
): string | undefined {
  switch (status) {
    case "invalid":
      return "That doesn't look like an email address.";
    case "self":
      return "That's your own address.";
    case "member":
      return `Already ${article(context.memberEmails.get(recipient.email)!)} ${context.memberEmails.get(
        recipient.email
      )} — sending will change their role to ${recipient.role}.`;
    case "invited":
      return `Already invited as ${context.invitedEmails.get(recipient.email)} — sending updates the pending role to ${recipient.role}.`;
    default:
      return undefined;
  }
}

function article(role: MembershipRole) {
  return role === "Editor" || role === "Owner" ? "an" : "a";
}

const TONE: Record<RecipientStatus, string> = {
  ok: "bg-surface-2 border-border text-text",
  invalid: "bg-danger/10 border-danger text-danger",
  self: "bg-danger/10 border-danger text-danger",
  member: "bg-warn/10 border-warn text-warn",
  invited: "bg-warn/10 border-warn text-warn",
};

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `recipient-${idCounter}`;
}

// Splits pasted or typed text into recipients, dropping blanks and anything
// already present so the same address can't be queued twice.
export function toRecipients(
  raw: string,
  role: MembershipRole,
  existing: Recipient[]
): Recipient[] {
  const seen = new Set(existing.map((r) => r.email));
  const added: Recipient[] = [];

  for (const piece of raw.split(SEPARATORS)) {
    const email = piece.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    added.push({ id: nextId(), email, role });
  }

  return added;
}

export function InviteRecipientsInput({
  recipients,
  draft,
  newRole,
  context,
  disabled,
  onRecipientsChange,
  onDraftChange,
}: {
  recipients: Recipient[];
  draft: string;
  newRole: MembershipRole;
  context: RecipientContext;
  disabled?: boolean;
  onRecipientsChange: (next: Recipient[]) => void;
  onDraftChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function commitDraft(text = draft): boolean {
    const added = toRecipients(text, newRole, recipients);
    onDraftChange("");
    if (added.length === 0) return false;
    onRecipientsChange([...recipients, ...added]);
    return true;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      // Enter must not submit the surrounding form while a draft is pending.
      e.preventDefault();
      commitDraft();
      return;
    }

    if (e.key === "Tab" && draft.trim()) {
      // Commit, but stay put -- otherwise Tab both commits and jumps away, and
      // you can't see what you just added.
      e.preventDefault();
      commitDraft();
      return;
    }

    if (e.key === "Backspace" && draft === "" && recipients.length > 0) {
      // Pop the last chip back into the text so a typo is editable, rather
      // than deleting it outright and making the user retype it.
      e.preventDefault();
      const last = recipients[recipients.length - 1];
      onRecipientsChange(recipients.slice(0, -1));
      onDraftChange(last.email);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!SEPARATORS.test(text)) return; // Single address: let the input handle it.

    e.preventDefault();
    const added = toRecipients(text, newRole, recipients);
    // A trailing fragment with no separator after it is still being typed.
    const trailing = SEPARATORS.test(text.slice(-1)) ? "" : (added.pop()?.email ?? "");
    if (added.length > 0) onRecipientsChange([...recipients, ...added]);
    onDraftChange(trailing);
  }

  function setRole(id: string, role: MembershipRole) {
    onRecipientsChange(recipients.map((r) => (r.id === id ? { ...r, role } : r)));
  }

  function remove(id: string) {
    onRecipientsChange(recipients.filter((r) => r.id !== id));
    inputRef.current?.focus();
  }

  const hasBlocking = recipients.some((r) => {
    const s = statusOf(r, context);
    return s === "invalid" || s === "self";
  });

  return (
    <div
      // Clicking anywhere in the field area focuses the text input, the way a
      // single-input field behaves.
      onClick={() => inputRef.current?.focus()}
      // The focus colour is chosen per branch rather than declared once
      // alongside border-danger: both are single-class selectors, so stylesheet
      // order decides, and Tailwind emits variants after base utilities. A
      // shared `focus-within:border-accent` therefore beats `border-danger`
      // exactly while you're typing -- hiding the validation state when it
      // matters most.
      // The focus ring belongs on this element, not the inner input. Globally
      // `*:focus-visible` paints a 3px ring, and everywhere else in the app the
      // focused element *is* the bordered box so the ring hugs its border. Here
      // the focusable input is a transparent child, so the default ring drew
      // inside the field border as a second outline. The input opts out (see
      // below) and the whole field carries the ring instead.
      //
      // Focus colour is also chosen per branch rather than declared once
      // alongside border-danger: both are single-class selectors, so stylesheet
      // order decides, and Tailwind emits variants after base utilities. A
      // shared `focus-within:border-accent` would beat `border-danger` exactly
      // while you're typing -- hiding the validation state when it matters most.
      className={`mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border bg-bg px-2 py-2 min-h-[42px] cursor-text transition-colors focus-within:shadow-[0_0_0_3px_var(--ring)] ${
        hasBlocking
          ? "border-danger focus-within:border-danger"
          : "border-border focus-within:border-accent"
      }`}
    >
      {recipients.map((recipient) => {
        const status = statusOf(recipient, context);
        const hint = statusHint(recipient, status, context);

        return (
          <span
            key={recipient.id}
            title={hint}
            className={`inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-[11px] font-medium max-w-full ${TONE[status]}`}
          >
            <span className="truncate">{recipient.email}</span>

            {status !== "invalid" && status !== "self" && (
              <select
                aria-label={`Role for ${recipient.email}`}
                value={recipient.role}
                disabled={disabled}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRole(recipient.id, e.target.value as MembershipRole)}
                className="appearance-none bg-transparent border-0 outline-none text-[11px] font-semibold cursor-pointer pr-0.5 focus-visible:underline"
              >
                {INVITE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              aria-label={`Remove ${recipient.email}`}
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                remove(recipient.id);
              }}
              className="w-4 h-4 flex items-center justify-center rounded-full opacity-60 hover:opacity-100 hover:bg-black/10 cursor-pointer shrink-0"
            >
              <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
                <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        );
      })}

      <input
        ref={inputRef}
        id="invite-email"
        // Not type="email": the field holds a list, and a browser-level single
        // address check would fight it. Validation is per chip instead.
        type="text"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={recipients.length === 0 ? "teammate@example.com" : "Add another…"}
        value={draft}
        aria-describedby="invite-hint"
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => draft.trim() && commitDraft()}
        // Opts out of the global focus ring, which would otherwise paint a
        // second outline around this transparent input, inset inside the
        // field's border. The wrapper carries the ring instead. See the
        // data-focus-ring rule in globals.css for why this can't be a
        // `focus-visible:shadow-none` utility.
        data-focus-ring="none"
        className="flex-1 min-w-[160px] bg-transparent border-0 outline-none text-sm text-text placeholder:text-text-dim py-0.5"
      />
    </div>
  );
}
