"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ActivityResponse } from "@/lib/api";
import { friendlyError } from "@/lib/errorMessage";
import { relativeTime } from "@/lib/relativeTime";
import { useDialog } from "@/lib/useDialog";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

function EntrySkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-5 py-3">
      <Skeleton className="w-6 h-6 rounded-full shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-2.5 w-40 rounded" />
        <Skeleton className="h-2 w-20 rounded" />
      </div>
    </div>
  );
}

/**
 * Who changed what, and a way to take back your own last change.
 *
 * Refetches whenever the board's sequence moves, which is what makes it live:
 * every mutation from anyone bumps that number, and the feed is a projection of
 * exactly the log that number counts.
 */
export function ActivityPanel({
  boardId,
  boardSeq,
  canEdit,
  getToken,
  onClose,
  onUndone,
}: {
  boardId: string;
  boardSeq: number;
  canEdit: boolean;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onUndone: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  useDialog({ containerRef: panelRef, onClose });

  const fetchActivity = useCallback(async () => {
    const token = await getToken();
    return api.get<ActivityResponse>(`/boards/${boardId}/activity`, token);
  }, [boardId, getToken]);

  const load = useCallback(async () => {
    try {
      setActivity(await fetchActivity());
      setError(null);
    } catch (err) {
      setError(friendlyError(err, "load the activity").message);
    }
  }, [fetchActivity]);

  useEffect(() => {
    // Guarded rather than fire-and-forget: a burst of operations starts several
    // fetches, and without this the slowest one wins and paints a feed that is
    // older than the board.
    let cancelled = false;

    (async () => {
      try {
        const next = await fetchActivity();
        if (!cancelled) {
          setActivity(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(friendlyError(err, "load the activity").message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // boardSeq is the dependency that matters: it advances on every operation
    // from anyone, so the feed follows the board without a poll.
  }, [fetchActivity, boardSeq]);

  async function handleUndo() {
    setUndoing(true);
    setError(null);
    try {
      const token = await getToken();
      await api.post(`/boards/${boardId}/undo`, token, {});
      onUndone();
      await load();
    } catch (err) {
      setError(friendlyError(err, "undo that").message);
      // Reload regardless: a 409 means the board moved on, and the feed the
      // user is looking at is now the stale thing.
      await load();
    } finally {
      setUndoing(false);
    }
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/20 z-30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Board activity"
        className="absolute top-0 right-0 bottom-0 w-[360px] bg-surface border-l border-border flex flex-col z-40 animate-[fade-up_0.2s_ease-out] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-dim">Activity</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:bg-surface-2 cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {canEdit && (
          <div className="px-5 py-3 border-b border-border shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-text-muted">
              {activity?.undoableSeq != null
                ? "You can take back your most recent change."
                : "Nothing of yours left to undo."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleUndo}
              disabled={undoing || activity?.undoableSeq == null}
            >
              {undoing ? "Undoing…" : "Undo"}
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="px-5 py-3 text-xs text-danger border-b border-border shrink-0">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto">
          {activity === null && !error ? (
            <div role="status" aria-busy="true">
              <span className="sr-only">Loading activity…</span>
              <EntrySkeleton />
              <EntrySkeleton />
              <EntrySkeleton />
            </div>
          ) : activity && activity.entries.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-text-dim">
              Nothing has happened on this board yet. Changes show up here as people make them.
            </p>
          ) : (
            <ul className="flex flex-col">
              {activity?.entries.map((entry) => (
                <li
                  key={entry.seq}
                  className="flex items-start gap-2.5 px-5 py-3 border-b border-border last:border-b-0"
                >
                  <Avatar name={entry.actorName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-[13px] leading-snug ${
                        entry.undone ? "text-text-dim line-through" : "text-text"
                      }`}
                    >
                      <span className="font-medium">{entry.actorName}</span> {entry.summary}
                    </p>
                    <p className="text-[11px] text-text-dim mt-0.5">
                      {relativeTime(entry.createdAt)}
                      {/* Struck-through alone would only read as "undone" to
                          someone who can see it. */}
                      {entry.undone && <span className="ml-1.5">· undone</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
