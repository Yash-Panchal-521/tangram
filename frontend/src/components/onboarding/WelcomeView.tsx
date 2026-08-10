"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  api,
  type BoardResponse,
  type WorkspaceResponse,
  type WorkspaceSummaryResponse,
} from "@/lib/api";
import { friendlyError } from "@/lib/errorMessage";
import {
  BOARD_TEMPLATES,
  DEFAULT_TEMPLATE,
  suggestedWorkspaceName,
} from "@/lib/boardTemplates";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { AuthField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { authInputClasses } from "@/lib/authForm";

const EMAIL_SPLIT = /[,;\s]+/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one screen between signing up and having a board.
 *
 * Kept to a single step with everything pre-filled, because onboarding a person
 * has to get through before reaching the product is a cost, not a feature — the
 * research is unambiguous that it should be skippable and short. Nothing here is
 * mandatory: pressing Enter immediately produces exactly what the old automatic
 * bootstrap produced.
 *
 * What it does buy: names that someone chose rather than "My Workspace" /
 * "My Board", a board shape that matches the work, and the invite prompt at the
 * only moment when intent is high — which matters because collaboration is the
 * entire point of this app and was previously invisible until you went looking
 * for the members page.
 */
export function WelcomeView() {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();
  const workspaceId = useId();
  const boardId = useId();
  const inviteId = useId();

  const [workspaceName, setWorkspaceName] = useState("");
  const [boardName, setBoardName] = useState("My board");
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE.id);
  const [invites, setInvites] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null until we know whether this person already has somewhere to work.
  const [existing, setExisting] = useState<WorkspaceSummaryResponse[] | null>(null);

  // Guards the double submit that a fast Enter-then-click produces. A second
  // run would create a second workspace, which is precisely the mess the
  // bootstrap was rewritten to avoid.
  const started = useRef(false);

  const template = BOARD_TEMPLATES.find((t) => t.id === templateId) ?? DEFAULT_TEMPLATE;
  // Non-null when a workspace already exists to put the board in.
  const reusingWorkspace = existing?.[0] ?? null;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const workspaces = await api.get<WorkspaceSummaryResponse[]>("/workspaces", token);
        if (cancelled) return;

        // Already set up — an invited teammate, or someone who has been here
        // before. Setting up again is not a thing they need.
        if (workspaces.some((w) => w.boards.length > 0)) {
          router.replace("/boards");
          return;
        }
        setExisting(workspaces);
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, "get you started").message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, router, getToken]);

  // Suggested once the display name is known, and only as a starting value --
  // typing over it must stick.
  const nameSuggested = useRef(false);
  useEffect(() => {
    if (nameSuggested.current || !user?.displayName) return;
    nameSuggested.current = true;
    setWorkspaceName(suggestedWorkspaceName(user.displayName));
  }, [user?.displayName]);

  async function createEverything(withInvites: boolean) {
    if (started.current) return;
    started.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();

      // Reuse an empty workspace rather than stacking a second one -- someone
      // can arrive here having had one created but no board in it.
      const targetWorkspace =
        reusingWorkspace?.id ??
        (
          await api.post<WorkspaceResponse>("/workspaces", token, {
            name: workspaceName.trim() || suggestedWorkspaceName(user?.displayName),
          })
        ).id;

      const board = await api.post<BoardResponse>(
        `/workspaces/${targetWorkspace}/boards`,
        token,
        { name: boardName.trim() || "My board", columns: template.columns }
      );

      if (withInvites) {
        const emails = invites
          .split(EMAIL_SPLIT)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => EMAIL_PATTERN.test(e));

        // One failure must not cost someone the board they just made, so these
        // are attempted individually and never rethrow. Anyone missed can be
        // invited again from the members page.
        for (const email of emails) {
          await api
            .post(`/workspaces/${targetWorkspace}/members`, token, { email, role: "Editor" })
            .catch(() => {});
        }
      }

      try {
        window.localStorage.setItem("tangram-board-id", board.id);
      } catch {
        // Only a convenience for the next sign-in; the landing page validates it.
      }
      router.replace(`/board/${board.id}`);
    } catch (err) {
      started.current = false;
      setSubmitting(false);
      setError(friendlyError(err, "set up your board").message);
    }
  }

  const invalidInvites = invites
    .split(EMAIL_SPLIT)
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !EMAIL_PATTERN.test(e));

  return (
    <div className="flex-1 flex overflow-hidden">
      <AuthBrandPanel
        headline={
          <>
            One minute,
            <br />
            then you&apos;re working.
          </>
        }
        subhead="Name it, pick a shape, bring your team. All of it is changeable later — none of it is required now."
      />

      <div className="flex-1 bg-bg relative flex flex-col items-center justify-center p-12 overflow-y-auto">
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        {existing === null && !error ? (
          <div role="status" aria-busy="true" className="w-full max-w-[420px] flex flex-col gap-4">
            <span className="sr-only">Getting things ready…</span>
            <Skeleton className="h-6 w-48 rounded" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : (
          <div className="w-full max-w-[420px] animate-[fade-up_0.25s_ease-out]">
            <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
              Let&apos;s set up your board.
            </h2>
            <p className="text-[13px] text-text-muted mb-7">
              Everything here has a sensible default — skip if you&apos;d rather just start.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createEverything(true);
              }}
              className="flex flex-col gap-4"
            >
              {/* Someone can reach this screen already owning an empty
                  workspace -- created for them, never filled. The board goes
                  there rather than stacking a second one, so offering a name
                  field would be offering a control that silently does nothing.
                  Name it or state it; don't pretend. */}
              {reusingWorkspace ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                    Workspace
                  </span>
                  <p className="text-[13px] text-text-muted">
                    Adding to{" "}
                    <span className="font-medium text-text">{reusingWorkspace.name}</span>, the
                    workspace you already have.
                  </p>
                </div>
              ) : (
                <AuthField id={workspaceId} label="Workspace">
                  <input
                    id={workspaceId}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Ada's workspace"
                    autoFocus
                    className={authInputClasses}
                  />
                </AuthField>
              )}

              <AuthField id={boardId} label="First board">
                <input
                  id={boardId}
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  placeholder="My board"
                  className={authInputClasses}
                />
              </AuthField>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[11px] font-semibold uppercase tracking-wider text-text-dim mb-1.5">
                  Columns
                </legend>
                <div className="flex flex-col gap-2">
                  {BOARD_TEMPLATES.map((option) => {
                    const selected = option.id === templateId;
                    return (
                      <label
                        key={option.id}
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                          selected
                            ? "border-accent bg-surface"
                            : "border-border bg-surface hover:border-border-2"
                        }`}
                      >
                        <input
                          type="radio"
                          name="template"
                          value={option.id}
                          checked={selected}
                          onChange={() => setTemplateId(option.id)}
                          className="mt-0.5 accent-accent"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium">{option.name}</span>
                          <span className="block text-[11px] text-text-muted">
                            {option.description}
                          </span>
                          {/* The actual columns, not just a label. The choice is
                              only meaningful if you can see what it produces. */}
                          <span className="block text-[11px] text-text-dim mt-1">
                            {option.columns.join(" · ")}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <AuthField
                id={inviteId}
                label="Invite your team (optional)"
                hint={
                  invalidInvites.length > 0 ? (
                    <p className="text-[11px] text-warn">
                      {invalidInvites.length === 1
                        ? `“${invalidInvites[0]}” doesn't look like an email address — it'll be skipped.`
                        : `${invalidInvites.length} of these don't look like email addresses and will be skipped.`}
                    </p>
                  ) : (
                    <p className="text-[11px] text-text-dim">
                      They join as editors, and can watch the board with you the moment they sign
                      up.
                    </p>
                  )
                }
              >
                <textarea
                  id={inviteId}
                  value={invites}
                  onChange={(e) => setInvites(e.target.value)}
                  placeholder="sam@company.com, ada@company.com"
                  rows={2}
                  className={`${authInputClasses} resize-none`}
                />
              </AuthField>

              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1">
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? "Setting up…" : "Create my board →"}
                </Button>
                {/* Skipping is not a lesser path -- it produces exactly what the
                    automatic bootstrap produced before this screen existed. */}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => void createEverything(false)}
                >
                  Skip
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
