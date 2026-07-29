"use client";

import { useMemo, useState } from "react";
import type { MembershipRole } from "@/lib/api";
import {
  INVITE_ROLES,
  InviteRecipientsInput,
  statusOf,
  type Recipient,
  type RecipientContext,
} from "@/components/workspace/InviteRecipientsInput";

// Colocated with the kitchen-sink page rather than components/: it exists to
// exercise the chips field's keyboard contract, not to be reused.
export function InviteChipsDemo() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [draft, setDraft] = useState("");
  const [newRole, setNewRole] = useState<MembershipRole>("Editor");

  // Stand-in roster so the "self" / "already a member" / "already invited"
  // states are reachable without a backend.
  const context: RecipientContext = useMemo(
    () => ({
      myEmail: "you@example.com",
      memberEmails: new Map([["sara@example.com", "Editor" as MembershipRole]]),
      invitedEmails: new Map([["pending@example.com", "Viewer" as MembershipRole]]),
    }),
    []
  );

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      <InviteRecipientsInput
        recipients={recipients}
        draft={draft}
        newRole={newRole}
        context={context}
        onRecipientsChange={setRecipients}
        onDraftChange={setDraft}
      />

      <div className="flex items-center gap-2">
        <label htmlFor="demo-new-role" className="text-xs text-text-muted">
          New additions
        </label>
        <select
          id="demo-new-role"
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as MembershipRole)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {INVITE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-text-dim leading-relaxed">
        Try: paste <code className="text-text-muted">a@b.com, sara@example.com nope</code> ·
        Backspace on an empty field · change a chip&apos;s role · <code className="text-text-muted">you@example.com</code>
      </p>

      <pre data-testid="chips-state" className="text-[11px] text-text-muted">
        {JSON.stringify(
          recipients.map((r) => ({ email: r.email, role: r.role, status: statusOf(r, context) })),
          null,
          1
        )}
      </pre>
    </div>
  );
}
