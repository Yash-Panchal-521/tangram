"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  api,
  ApiError,
  type MeResponse,
  type MembershipRole,
  type MemberResponse,
  type PendingInvitationResponse,
  type WorkspaceMembersResponse,
  type WorkspaceSummaryResponse,
} from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { UserMenu } from "@/components/ui/UserMenu";
import { TangramMark } from "@/components/ui/TangramMark";
import { useConfirm, type ConfirmOptions } from "@/components/ui/ConfirmDialog";
import { InvitePanel } from "@/components/workspace/InvitePanel";
import { CopyInviteButton } from "@/components/workspace/CopyInviteButton";

const ROLES: MembershipRole[] = ["Owner", "Editor", "Viewer"];
const ROLE_ORDER: Record<MembershipRole, number> = { Owner: 0, Editor: 1, Viewer: 2 };

const NOTICE_TIMEOUT_MS = 6000;

function roleTone(role: MembershipRole) {
  return role === "Owner" ? "accent" : "neutral";
}

function article(role: MembershipRole) {
  return role === "Editor" || role === "Owner" ? "an" : "a";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function roleChangeConfirm(
  member: MemberResponse,
  newRole: MembershipRole,
  isSelf: boolean
): ConfirmOptions {
  if (isSelf) {
    return {
      title: `Change your own role to ${newRole}?`,
      body:
        newRole === "Viewer"
          ? "You'll immediately lose the ability to edit this board or manage members, and only another owner could give it back."
          : "You'll immediately lose the ability to manage members and roles, and only another owner could give it back.",
      confirmLabel: `Yes, become ${article(newRole)} ${newRole}`,
      tone: "danger",
    };
  }

  if (newRole === "Owner") {
    return {
      title: `Make ${member.displayName} an owner?`,
      body: "Owners can invite and remove people, change roles — including yours — and delete boards.",
      confirmLabel: "Make owner",
    };
  }

  if (newRole === "Viewer") {
    return {
      title: `Change ${member.displayName} to viewer?`,
      body: "They'll keep read-only access: still able to watch the board live, but not change anything on it.",
      confirmLabel: "Change to viewer",
      tone: "danger",
    };
  }

  return {
    title: `Change ${member.displayName} to editor?`,
    body:
      member.role === "Owner"
        ? "They'll still be able to edit the board, but no longer manage members or roles."
        : "They'll be able to add, edit, move, and delete columns and cards.",
    confirmLabel: "Change to editor",
  };
}

function MemberSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border border-border overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`flex items-center gap-3 px-3.5 py-3 bg-surface ${
            i > 0 ? "border-t border-border" : ""
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-surface-2 animate-pulse shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-32 rounded bg-surface-2 animate-pulse" />
            <div className="h-2.5 w-48 rounded bg-surface-2 animate-pulse" />
          </div>
          <div className="h-6 w-16 rounded-full bg-surface-2 animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceMembersView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const { confirm, dialog } = useConfirm();

  const [workspace, setWorkspace] = useState<WorkspaceSummaryResponse | null>(null);
  const [members, setMembers] = useState<MemberResponse[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitationResponse[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // Bumped to remount the role selects. A native select keeps whatever the user
  // picked in the DOM, and React won't reset it when the controlled value prop
  // hasn't changed -- so after a cancelled confirmation the row would keep
  // showing a role the server never received.
  const [selectGeneration, setSelectGeneration] = useState(0);
  // null until the roster loads, then set once from it. After that it's the
  // user's own toggle, so a reload can't slam the panel shut mid-typing.
  const [inviteOpen, setInviteOpen] = useState<boolean | null>(null);

  const isOwner = workspace?.role === "Owner";
  const ownerCount = members.filter((m) => m.role === "Owner").length;
  const sortedMembers = [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.displayName.localeCompare(b.displayName)
  );

  const myEmail = members.find((m) => m.userId === myUserId)?.email?.toLowerCase() ?? null;
  const isFirstRun = members.length === 1 && invitations.length === 0;

  const load = useCallback(async () => {
    const token = await getToken();
    // /me resolves the caller's internal id. Matching on email mostly works but
    // breaks on case differences, and getting "which row is me" wrong here means
    // offering to remove the wrong person.
    const [workspaces, roster, me] = await Promise.all([
      api.get<WorkspaceSummaryResponse[]>("/workspaces", token),
      api.get<WorkspaceMembersResponse>(`/workspaces/${workspaceId}/members`, token),
      api.get<MeResponse>("/me", token),
    ]);

    setWorkspace(workspaces.find((w) => w.id === workspaceId) ?? null);
    setMembers(roster.members);
    setInvitations(roster.pendingInvitations);
    setMyUserId(me.id);
  }, [getToken, workspaceId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? "That workspace doesn't exist, or you're not a member of it."
            : "Couldn't load members. Is the backend running?"
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, load]);

  // Inviting *is* the page when you're the only member, so it opens itself.
  // Once anyone else is present the roster is what you came for, and the panel
  // starts collapsed. Only seeds once -- see the state declaration.
  useEffect(() => {
    if (!ready || inviteOpen !== null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInviteOpen(isFirstRun);
  }, [ready, inviteOpen, isFirstRun]);

  // Success notices describe something that already finished, so they shouldn't
  // linger and imply it just happened. Errors stay until dismissed or replaced.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Every mutation re-reads from the server rather than patching local state:
  // the server owns the last-owner rules, so its view is the only trustworthy
  // one.
  async function run(action: () => Promise<void>, successNotice?: string) {
    setActionError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (successNotice) setNotice(successNotice);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function handleRoleChange(member: MemberResponse, role: MembershipRole) {
    if (role === member.role) return;

    const isSelf = member.userId === myUserId;
    if (!(await confirm(roleChangeConfirm(member, role, isSelf)))) {
      setSelectGeneration((g) => g + 1);
      return;
    }

    setBusyUserId(member.userId);
    await run(
      async () => {
        const token = await getToken();
        await api.patch(`/workspaces/${workspaceId}/members/${member.userId}`, token, { role });
      },
      `${isSelf ? "You are" : `${member.displayName} is`} now ${article(role)} ${role}.`
    );
    setBusyUserId(null);
  }

  async function handleRemove(member: MemberResponse) {
    const isSelf = member.userId === myUserId;

    const confirmed = await confirm(
      isSelf
        ? {
            title: "Leave this workspace?",
            body: "You'll lose access to its boards immediately, and only a remaining owner could invite you back.",
            confirmLabel: "Leave workspace",
            tone: "danger",
          }
        : {
            title: `Remove ${member.displayName}?`,
            body: `They'll lose access to this workspace's boards right away. Their cards stay put, and you can invite ${
              member.email ?? "them"
            } again later.`,
            confirmLabel: "Remove",
            tone: "danger",
          }
    );
    if (!confirmed) return;

    setBusyUserId(member.userId);

    // Leaving has to bypass run(): its post-action refresh would 404 now that
    // the caller isn't a member, reporting a failure for something that worked.
    if (isSelf) {
      setActionError(null);
      setNotice(null);
      try {
        const token = await getToken();
        await api.delete(`/workspaces/${workspaceId}/members/${member.userId}`, token);
        router.replace("/board");
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : "Something went wrong.");
        setBusyUserId(null);
      }
      return;
    }

    await run(async () => {
      const token = await getToken();
      await api.delete(`/workspaces/${workspaceId}/members/${member.userId}`, token);
    }, `Removed ${member.displayName}.`);
    setBusyUserId(null);
  }

  async function handleRevoke(invitation: PendingInvitationResponse) {
    const confirmed = await confirm({
      title: "Revoke this invitation?",
      body: `${invitation.email} won't be added when they sign up. You can invite them again at any time.`,
      confirmLabel: "Revoke invitation",
      tone: "danger",
    });
    if (!confirmed) return;

    await run(async () => {
      const token = await getToken();
      await api.delete(`/workspaces/${workspaceId}/members/invitations/${invitation.id}`, token);
    }, `Revoked the invitation for ${invitation.email}.`);
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-danger max-w-sm">{loadError}</p>
        <Link href="/board">
          <Button variant="secondary" size="sm">
            Back to board
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-[52px] shrink-0 flex items-center px-4.5 border-b border-border bg-surface">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6.5 h-6.5 rounded-md bg-accent flex items-center justify-center shrink-0">
            <TangramMark size={14} color="var(--accent-fg)" />
          </div>
          <span className="text-sm font-semibold truncate">{workspace?.name ?? "Workspace"}</span>
          <span className="text-sm text-text-dim shrink-0">/</span>
          <span className="text-sm text-text-muted shrink-0">Members</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/board">
            <Button variant="ghost" size="sm">
              ← Back to board
            </Button>
          </Link>
          <div className="w-px h-4.5 bg-border" />
          <UserMenu />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl w-full px-6 py-8 flex flex-col gap-7">
          {(actionError || notice) && (
            <div
              // Errors are assertive, success is polite. Both were role="status"
              // before, so failures could pass unannounced.
              role={actionError ? "alert" : "status"}
              className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] animate-[fade-up_0.2s_ease-out] ${
                actionError
                  ? "border-danger bg-danger/10 text-danger"
                  : "border-success bg-success/10 text-success"
              }`}
            >
              <span className="flex-1">{actionError ?? notice}</span>
              <button
                onClick={() => {
                  setActionError(null);
                  setNotice(null);
                }}
                aria-label="Dismiss message"
                className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer mt-0.5"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M1 1L11 11M11 1L1 11"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}

          {isOwner && ready && (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">
                  Invite
                </h2>
                <button
                  type="button"
                  aria-expanded={Boolean(inviteOpen)}
                  aria-controls="invite-panel"
                  onClick={() => setInviteOpen((open) => !open)}
                  className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text cursor-pointer"
                >
                  {inviteOpen ? (
                    "Hide"
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <line x1="6" y1="2" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Invite people
                    </>
                  )}
                </button>
              </div>

              {inviteOpen && (
                <div id="invite-panel" className="flex flex-col gap-2.5">
                  {isFirstRun && (
                    <p className="text-[13px] text-text-muted leading-relaxed">
                      You&apos;re the only member so far. Add someone and the board turns
                      collaborative — you&apos;ll see their cursor and avatar move in real time.
                    </p>
                  )}
                  <InvitePanel
                    workspaceId={workspaceId}
                    workspaceName={workspace?.name ?? "this workspace"}
                    members={members}
                    invitations={invitations}
                    myEmail={myEmail}
                    onInvited={load}
                  />
                </div>
              )}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">
                Members
                {ready && <span className="ml-1.5 text-text-muted">{members.length}</span>}
              </h2>
              {!isOwner && workspace?.role && (
                <span className="text-xs text-text-muted">
                  You&apos;re {article(workspace.role)}{" "}
                  <span className="font-medium text-text">{workspace.role}</span> — only owners can
                  invite or change roles.
                </span>
              )}
            </div>

            {!ready ? (
              <MemberSkeleton />
            ) : (
              <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                {sortedMembers.map((member, i) => {
                  const isSelf = member.userId === myUserId;
                  const isLastOwner = member.role === "Owner" && ownerCount === 1;
                  const busy = busyUserId === member.userId;
                  const lastOwnerHint = isLastOwner
                    ? "A workspace must keep at least one owner."
                    : undefined;

                  return (
                    <div
                      key={member.userId}
                      className={`flex items-center gap-3 px-3.5 py-3 bg-surface transition-colors hover:bg-surface-2 ${
                        i > 0 ? "border-t border-border" : ""
                      }`}
                    >
                      <Avatar name={member.displayName} size="md" />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[13px] font-medium truncate">{member.displayName}</p>
                          {/* Without this you can't tell your own row from
                              anyone else's, which is how people demote
                              themselves by accident. */}
                          {isSelf && (
                            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-dim border border-border rounded px-1 py-px">
                              You
                            </span>
                          )}
                        </div>
                        {member.email && (
                          <p className="text-xs text-text-muted truncate">{member.email}</p>
                        )}
                      </div>

                      {isOwner ? (
                        <div className="w-[122px] shrink-0" title={lastOwnerHint}>
                          <Select
                            key={`${member.userId}-${selectGeneration}`}
                            aria-label={`Role for ${member.displayName}`}
                            value={member.role}
                            // Disabled rather than letting the server 400: the
                            // rule is knowable here, so say so up front.
                            disabled={busy || isLastOwner}
                            onChange={(e) =>
                              handleRoleChange(member, e.target.value as MembershipRole)
                            }
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : (
                        <Badge tone={roleTone(member.role)} className="shrink-0">
                          {member.role}
                        </Badge>
                      )}

                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={
                            lastOwnerHint ??
                            (isSelf ? "Leave workspace" : `Remove ${member.displayName}`)
                          }
                          aria-label={isSelf ? "Leave workspace" : `Remove ${member.displayName}`}
                          disabled={busy || isLastOwner}
                          onClick={() => handleRemove(member)}
                          className="shrink-0 hover:text-danger"
                        >
                          {isSelf ? (
                            "Leave"
                          ) : (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M2 3h8M4.5 3V2a1 1 0 011-1h1a1 1 0 011 1v1M3 3l.5 7a1 1 0 001 1h3a1 1 0 001-1L9 3"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {invitations.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">
                Pending
                <span className="ml-1.5 text-text-muted">{invitations.length}</span>
              </h2>

              <div className="flex flex-col rounded-lg border border-dashed border-border overflow-hidden">
                {invitations.map((invitation, i) => (
                  <div
                    key={invitation.id}
                    className={`flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface ${
                      i > 0 ? "border-t border-dashed border-border" : ""
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center shrink-0 text-text-dim">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="1.5"
                          y="3.5"
                          width="11"
                          height="7"
                          rx="1"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <path
                          d="M1.8 4.2L7 8l5.2-3.8"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate">{invitation.email}</p>
                      {/* Was "Invited as {role}" sitting next to a badge saying
                          the same thing; the useful second line is when. */}
                      <p className="text-xs text-text-muted">
                        Invited {relativeTime(invitation.createdAt)} · hasn&apos;t signed in yet
                      </p>
                    </div>

                    <Badge tone={roleTone(invitation.role)} className="shrink-0">
                      {invitation.role}
                    </Badge>

                    {isOwner && (
                      <>
                        {/* The durable home for this: nothing emails the
                            invitee, so an owner needs to re-copy the message
                            days later without re-inviting. */}
                        <CopyInviteButton
                          email={invitation.email}
                          workspaceName={workspace?.name ?? "this workspace"}
                          label="Copy invite"
                          className="shrink-0"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(invitation)}
                          className="shrink-0 hover:text-danger"
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {dialog}
    </div>
  );
}
