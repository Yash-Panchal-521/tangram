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
import { AuthField } from "@/components/auth/AuthField";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { authInputClasses } from "@/lib/authForm";

/**
 * The three things worth knowing before the first card, from the design.
 *
 * At the foot rather than up top: they are orientation, not instructions, and
 * nobody reads a numbered list before they have chosen anything.
 */
const FIRST_RUN_NOTES = [
  { step: "01", body: "Cards carry a priority, labels, one assignee and a due day. Nothing is required." },
  { step: "02", body: "Give a column a limit and the board tells you when work in it stops moving." },
  { step: "03", body: "Everyone sees the same board as it changes. The operation log says who changed what." },
];

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
    <div className="flex-1 bg-bg overflow-y-auto relative">
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>

      {/* No brand panel here, unlike /login and /signup. First run is a page you
          act on rather than a door you come through, and the design gives it the
          full width and one centred column for that reason. */}
      <div className="max-w-[800px] mx-auto px-10 pt-[70px] pb-20">
        {existing === null && !error ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-5">
            <span className="sr-only">Getting things ready…</span>
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-12 w-2/3 rounded" />
            <Skeleton className="h-16 w-full rounded" />
            <Skeleton className="h-16 w-full rounded" />
          </div>
        ) : (
          <div className="animate-[fade-up_0.25s_ease-out]">
            <p className="text-[10px] uppercase tracking-[0.14em] text-text-dim">First run</p>
            <h1
              className="mt-4 text-[44px] font-normal leading-[1.12] tracking-[-0.014em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {reusingWorkspace ? reusingWorkspace.name : "Your workspace"} is empty.
              <br />
              <span className="text-accent">Pick a shape</span> and start.
            </h1>
            <p className="mt-5 max-w-[520px] text-[15px] leading-[1.7] text-text-muted">
              Columns are the stages work moves through. Rename anything later — columns, limits
              and labels are all editable in place.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createEverything(true);
              }}
            >
              {/* Names first, then the shape. The design shows only the template
                  list, but a workspace and a board still need names, and choosing
                  a shape for something unnamed is the wrong order. */}
              <div className="mt-11 flex flex-col gap-[15px] max-w-[420px]">
                {reusingWorkspace ? (
                  // Someone can reach this screen already owning an empty
                  // workspace -- created for them, never filled. The board goes
                  // there rather than stacking a second one, so a name field
                  // would be a control that silently does nothing.
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-dim">
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
                      placeholder="Rita's workspace"
                      autoFocus
                      data-focus-ring="none"
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
                    data-focus-ring="none"
                    className={authInputClasses}
                  />
                </AuthField>
              </div>

              {/* The heavy rule is the design's device for opening a list: a full
                  --text line above it, hairlines between the rows. It reads as a
                  table of choices rather than a stack of cards. */}
              <fieldset className="mt-11 border-t border-text">
                <legend className="sr-only">Columns</legend>
                {BOARD_TEMPLATES.map((option, index) => {
                  const selected = option.id === templateId;
                  return (
                    <label
                      key={option.id}
                      className={
                        selected
                          ? "grid grid-cols-[52px_minmax(0,1fr)_auto] gap-5 items-center w-full py-5 px-2 border-b border-border-2 cursor-pointer transition-colors bg-surface"
                          : "grid grid-cols-[52px_minmax(0,1fr)_auto] gap-5 items-center w-full py-5 px-2 border-b border-border-2 cursor-pointer transition-colors hover:bg-surface"
                      }
                    >
                      <input
                        type="radio"
                        name="template"
                        value={option.id}
                        checked={selected}
                        onChange={() => setTemplateId(option.id)}
                        className="sr-only"
                      />
                      <span
                        className={
                          selected
                            ? "text-[26px] font-semibold text-accent"
                            : "text-[26px] font-semibold text-text-dim"
                        }
                        style={{ fontFamily: "var(--font-display)" }}
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[16px] font-medium tracking-[-0.012em]">
                          {option.name}
                        </span>
                        {/* The columns themselves, not a summary. The choice only
                            means something if you can see what it produces. */}
                        <span className="flex gap-[7px] mt-2 flex-wrap">
                          {option.columns.map((c) => (
                            <span
                              key={c}
                              className="px-2 py-0.5 border border-border rounded-md text-[11px] text-text-muted"
                            >
                              {c}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span
                        className={
                          selected
                            ? "text-[10px] uppercase tracking-[0.11em] text-accent"
                            : "text-[10px] uppercase tracking-[0.11em] text-text-dim"
                        }
                      >
                        {selected ? "Selected" : "Choose"}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <div className="mt-8 max-w-[420px]">
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
                    placeholder="sam@studio.com, ada@studio.com"
                    rows={2}
                    data-focus-ring="none"
                    className={`${authInputClasses} resize-none`}
                  />
                </AuthField>
              </div>

              {error && (
                <p role="alert" className="mt-4 text-xs text-danger">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-4 mt-8">
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Setting up…" : "Create board"}
                </Button>
                {/* Skipping is not a lesser path -- it produces exactly what the
                    automatic bootstrap produced before this screen existed, so it
                    says what it does rather than just "Skip". */}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void createEverything(false)}
                  className="text-[13px] text-text-dim hover:text-text transition-colors cursor-pointer disabled:opacity-50"
                >
                  Skip — start from an empty board
                </button>
              </div>
            </form>

            <div className="mt-16 pt-7 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-[30px]">
              {FIRST_RUN_NOTES.map((note) => (
                <div key={note.step}>
                  <p
                    className="text-[20px] font-semibold text-warn"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {note.step}
                  </p>
                  <p className="mt-2 text-[13px] leading-[1.65] text-text-muted text-pretty">
                    {note.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
