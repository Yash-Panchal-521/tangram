"use client";

import { useMemo, useState } from "react";
import { api, type MembershipRole, type MemberResponse, type PendingInvitationResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errorMessage";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { CopyInviteButton } from "@/components/workspace/CopyInviteButton";
import {
  INVITE_ROLES,
  InviteRecipientsInput,
  statusOf,
  type Recipient,
  type RecipientContext,
} from "@/components/workspace/InviteRecipientsInput";

const ROLE_INFO: Record<MembershipRole, string> = {
  Owner: "Full access to the board, plus managing members and their roles.",
  Editor: "Can add, edit, move, and delete columns and cards.",
  Viewer: "Read-only. Sees the board and everyone live, but can't change it.",
};

type InviteOutcome = "invited" | "added" | "updated" | "failed";

interface InviteResult {
  email: string;
  role: MembershipRole;
  outcome: InviteOutcome;
  detail?: string;
}

const OUTCOME_TEXT: Record<InviteOutcome, string> = {
  invited: "Invited — joins on first sign-in",
  added: "Added — already had an account",
  updated: "Already a member — role updated",
  failed: "Failed",
};

function article(role: MembershipRole) {
  return role === "Editor" || role === "Owner" ? "an" : "a";
}

export function InvitePanel({
  workspaceId,
  workspaceName,
  members,
  invitations,
  myEmail,
  onInvited,
}: {
  workspaceId: string;
  workspaceName: string;
  members: MemberResponse[];
  invitations: PendingInvitationResponse[];
  myEmail: string | null;
  onInvited: () => Promise<void>;
}) {
  const { getToken } = useAuth();

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [draft, setDraft] = useState("");
  const [newRole, setNewRole] = useState<MembershipRole>("Editor");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<InviteResult[]>([]);
  const [panelError, setPanelError] = useState<string | null>(null);

  const context: RecipientContext = useMemo(
    () => ({
      myEmail,
      memberEmails: new Map(
        members
          .filter((m) => m.email)
          .map((m) => [m.email!.toLowerCase(), m.role] as const)
      ),
      invitedEmails: new Map(invitations.map((i) => [i.email.toLowerCase(), i.role] as const)),
    }),
    [members, invitations, myEmail]
  );

  const statuses = recipients.map((r) => statusOf(r, context));
  const blockingCount = statuses.filter((s) => s === "invalid" || s === "self").length;
  const distinctRoles = new Set(recipients.map((r) => r.role));
  const canSubmit = recipients.length > 0 && blockingCount === 0 && !progress;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setPanelError(null);
    setResults([]);
    setProgress({ done: 0, total: recipients.length });

    const token = await getToken();
    const collected: InviteResult[] = [];

    // Sequential rather than parallel: the endpoint is per-address, and every
    // call bumps the same workspace, so concurrency buys only lock churn.
    for (const [index, recipient] of recipients.entries()) {
      const wasMember = context.memberEmails.has(recipient.email);
      try {
        const result = await api.post<{ joined: boolean }>(
          `/workspaces/${workspaceId}/members`,
          token,
          { email: recipient.email, role: recipient.role }
        );
        collected.push({
          email: recipient.email,
          role: recipient.role,
          outcome: wasMember ? "updated" : result.joined ? "added" : "invited",
        });
      } catch (err) {
        collected.push({
          email: recipient.email,
          role: recipient.role,
          outcome: "failed",
          // S3.3: the raw ApiError message can be "POST /… failed with 502".
          detail: friendlyError(err, "invite them").message,
        });
      }
      setProgress({ done: index + 1, total: recipients.length });
    }

    setProgress(null);
    setResults(collected);

    // Keep only failures as chips, so retrying is one click and the addresses
    // that worked can't be sent twice.
    const failed = new Set(collected.filter((r) => r.outcome === "failed").map((r) => r.email));
    setRecipients((current) => current.filter((r) => failed.has(r.email)));

    try {
      await onInvited();
    } catch {
      setPanelError("Invites were sent, but the member list couldn't be refreshed.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-end">
        <div className="flex-1 min-w-0">
          <label htmlFor="invite-email" className="text-xs font-medium text-text-muted">
            Email addresses
            <span className="text-text-dim font-normal">
              {" "}
              — paste a list, or add one at a time
            </span>
          </label>
          <InviteRecipientsInput
            recipients={recipients}
            draft={draft}
            newRole={newRole}
            context={context}
            disabled={Boolean(progress)}
            onRecipientsChange={setRecipients}
            onDraftChange={setDraft}
          />
        </div>

        <div className="w-full sm:w-[132px] shrink-0">
          <Select
            label="New additions"
            value={newRole}
            disabled={Boolean(progress)}
            onChange={(e) => setNewRole(e.target.value as MembershipRole)}
            className="bg-bg"
          >
            {INVITE_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </div>

        <Button type="submit" disabled={!canSubmit} className="shrink-0">
          {progress
            ? `Inviting ${progress.done}/${progress.total}…`
            : recipients.length > 1
              ? `Invite ${recipients.length}`
              : "Send invite"}
        </Button>
      </div>

      {/* One hint slot, most-blocking first, so the form explains itself before
          you submit rather than after. Per-chip detail lives in chip tooltips. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p id="invite-hint" className="text-xs leading-relaxed flex-1 min-w-[240px]">
          {blockingCount > 0 ? (
            <span className="text-danger">
              Fix or remove {blockingCount === 1 ? "the highlighted address" : `${blockingCount} highlighted addresses`} before sending.
            </span>
          ) : recipients.length === 0 ? (
            <span className="text-text-muted">
              <span className="font-medium text-text">{newRole}:</span> {ROLE_INFO[newRole]} No
              account needed yet — the invitation is claimed the first time they sign in.
            </span>
          ) : distinctRoles.size > 1 ? (
            <span className="text-text-muted">
              {recipients.length} people, mixed roles — each is invited at the role on its chip.
            </span>
          ) : (
            <span className="text-text-muted">
              <span className="font-medium text-text">
                {[...distinctRoles][0]}:
              </span>{" "}
              {ROLE_INFO[[...distinctRoles][0]]}
            </span>
          )}
        </p>

        {/* Only worth showing once roles actually diverge -- the uniform case
            is the common one and doesn't need the extra control. */}
        {distinctRoles.size > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-text-dim">Set all to</span>
            {INVITE_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRecipients((current) => current.map((r) => ({ ...r, role })))}
                className="text-xs font-medium text-accent hover:underline cursor-pointer"
              >
                {role}
              </button>
            ))}
          </div>
        )}
      </div>

      {panelError && <p className="text-xs text-danger">{panelError}</p>}

      {results.length > 0 && (
        <ul role="status" className="flex flex-col gap-1.5 border-t border-border pt-3">
          {results.map((result) => (
            <li
              key={result.email}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs animate-[fade-up_0.2s_ease-out]"
            >
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  result.outcome === "failed" ? "bg-danger" : "bg-success"
                }`}
              />
              <span className="font-medium truncate">{result.email}</span>
              <span className={result.outcome === "failed" ? "text-danger" : "text-text-muted"}>
                {OUTCOME_TEXT[result.outcome]}
                {result.outcome !== "failed" ? ` as ${article(result.role)} ${result.role}` : ""}
                {result.detail ? ` — ${result.detail}` : ""}
              </span>

              {/* Only pending invites need passing along; the others already
                  have accounts and will see the workspace on next load. */}
              {result.outcome === "invited" && (
                <CopyInviteButton
                  email={result.email}
                  workspaceName={workspaceName}
                  label="Copy invite"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
