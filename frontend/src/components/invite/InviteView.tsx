"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type InvitationOfferResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errorMessage";
import { expiresIn } from "@/lib/invite";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

const ROLE_MEANS: Record<string, string> = {
  Owner: "You'll be able to change the board and manage who else is in it.",
  Editor: "You'll be able to add, edit, move and delete columns and cards.",
  Viewer: "You'll be able to see the board and everyone on it live, but not change it.",
};

/**
 * The page an invitation link opens.
 *
 * Being added to a workspace puts your name and address in front of its owners,
 * and joining a tenant is not a thing that should happen to someone silently —
 * so this asks. It is also the only thing that grants membership now: the
 * previous design matched the caller's email against pending invitations on
 * every request, and nothing in the stack verifies an email address.
 *
 * Readable signed out on purpose. Deciding whether to create an account is hard
 * if you can't see what you'd be creating it for.
 */
export function InviteView({ token }: { token: string }) {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();

  const [offer, setOffer] = useState<InvitationOfferResponse | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; gone: boolean } | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  // Bumped to re-read the offer. A counter rather than a callback the effect
  // calls: the fetch lives inside the effect, so nothing sets state before the
  // first await and the cancelled-flag cleanup covers an unmount mid-flight.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // No auth token: the offer is anonymous by design, and sending one
        // would make this fail for the signed-out reader it exists for.
        const data = await api.get<InvitationOfferResponse>(`/invitations/${token}`, null);
        if (cancelled) return;
        setOffer(data);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        const gone = err instanceof ApiError && err.status === 404;
        setLoadError({
          message: gone
            ? "This invitation link isn't valid. It may have been revoked, or the link may have been cut short when it was copied."
            : friendlyError(err, "load this invitation").message,
          gone,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  function reload() {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }

  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setActionError(null);
    try {
      await api.post(`/invitations/${token}/${action}`, await getToken());
      if (action === "accept") {
        // Their workspace list has changed, so send them through the landing
        // page rather than guessing a board id from here.
        router.replace("/boards");
        return;
      }
      setDeclined(true);
    } catch (err) {
      setActionError(friendlyError(err, action === "accept" ? "accept this" : "decline this").message);
      // A 409 means the invitation moved on under us -- expired, or used in
      // another tab. Re-reading turns a dead button into the right explanation.
      if (err instanceof ApiError && err.status === 409) reload();
    } finally {
      setBusy(null);
    }
  }

  const signedIn = !loading && user !== null;
  // Where to come back to. Signing in is a detour, not a destination.
  const returnTo = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="flex-1 flex overflow-hidden">
      <AuthBrandPanel
        headline={
          <>
            You&apos;ve been
            <br />
            invited.
          </>
        }
        subhead="Tangram is a real-time collaborative board. Everyone sees the same thing at the same time, with roles that decide who can change it."
      />

      <div className="flex-1 bg-bg relative flex flex-col items-center justify-center p-12 overflow-y-auto">
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[400px]">
          {!offer && !loadError ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-4">
              <span className="sr-only">Loading this invitation…</span>
              <Skeleton className="h-7 w-56 rounded" />
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ) : loadError ? (
            <div className="animate-[fade-up_0.25s_ease-out]">
              <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
                {loadError.gone ? "That link doesn't work." : "Couldn't load this."}
              </h2>
              <p role="alert" className="text-[13px] text-text-muted mb-6">
                {loadError.message}
              </p>
              {/* S3.2: a next action, not just a diagnosis. Whose fault it is
                  decides which one is useful. */}
              {loadError.gone ? (
                <p className="text-[13px] text-text-muted">
                  Ask whoever invited you to send a fresh link from their members page.
                </p>
              ) : (
                <Button onClick={reload}>Try again</Button>
              )}
            </div>
          ) : declined ? (
            <div className="animate-[fade-up_0.25s_ease-out]">
              <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
                Turned down.
              </h2>
              <p className="text-[13px] text-text-muted mb-6">
                You haven&apos;t joined {offer!.workspaceName}, and {offer!.invitedByName} can
                invite you again if this was a mistake.
              </p>
              <Link href="/board" className="text-[13px] text-accent font-medium hover:underline">
                Go to Tangram →
              </Link>
            </div>
          ) : (
            <div className="animate-[fade-up_0.25s_ease-out]">
              <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
                Join {offer!.workspaceName}?
              </h2>
              <p className="text-[13px] text-text-muted mb-6">
                {offer!.invitedByName} invited you as {offer!.role === "Editor" || offer!.role === "Owner" ? "an" : "a"}{" "}
                <span className="font-medium text-text">{offer!.role}</span>.{" "}
                {ROLE_MEANS[offer!.role]}
              </p>

              {offer!.status !== "pending" ? (
                <StaleOffer status={offer!.status} workspaceName={offer!.workspaceName} />
              ) : (
                <>
                  <p className="text-xs text-text-dim mb-5">
                    This invitation expires {expiresIn(offer!.expiresAt)}.
                  </p>

                  {actionError && (
                    <p role="alert" className="text-xs text-danger mb-3">
                      {actionError}
                    </p>
                  )}

                  {/* S2.1: Firebase resolves a stored session asynchronously,
                      so without this a signed-in person is shown "Create an
                      account" for a beat -- indistinguishable from having been
                      logged out, on the one page where that matters most. */}
                  {loading ? (
                    <p role="status" aria-busy="true" className="text-[13px] text-text-muted">
                      Checking your session…
                    </p>
                  ) : signedIn ? (
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => void respond("accept")}
                        disabled={busy !== null}
                        className="flex-1"
                      >
                        {busy === "accept" ? "Joining…" : "Accept invitation →"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void respond("decline")}
                        disabled={busy !== null}
                      >
                        {busy === "decline" ? "Declining…" : "Decline"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {/* Both routes carry the destination, so signing in comes
                          back here rather than dropping you on a board you
                          haven't joined yet. */}
                      <Link href={`/signup?next=${returnTo}`} className={buttonClasses({}, "w-full")}>
                        Create an account to join →
                      </Link>
                      <Link
                        href={`/login?next=${returnTo}`}
                        className="text-[13px] text-text-muted text-center hover:text-text"
                      >
                        Already have an account?{" "}
                        <span className="text-accent font-medium">Sign in</span>
                      </Link>
                    </div>
                  )}

                  {signedIn && user?.email && (
                    <p className="text-[11px] text-text-dim mt-3">
                      Joining as {user.email}.{" "}
                      <Link
                        href={`/login?next=${returnTo}`}
                        className="text-accent hover:underline"
                      >
                        Use a different account
                      </Link>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Split out so the three dead ends read as one shape: what happened, and the
// one thing that would fix it.
function StaleOffer({ status, workspaceName }: { status: string; workspaceName: string }) {
  const text: Record<string, string> = {
    accepted: `This invitation has already been used. If that was you, ${workspaceName} is on your boards page.`,
    declined: "This invitation was turned down. Ask for a new one if you've changed your mind.",
    expired: "This invitation has expired. Invitations last seven days.",
  };

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-[13px] text-warn">
        {text[status] ?? "This invitation is no longer open."}
      </p>
      <Link href="/board" className="text-[13px] text-accent font-medium hover:underline">
        Go to Tangram →
      </Link>
    </div>
  );
}
