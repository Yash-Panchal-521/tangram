"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type InvitationOfferResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlyError } from "@/lib/errorMessage";
import {
  buildInviteLoginPath,
  buildInviteSignupPath,
  expiresIn,
  ROLE_MEANS,
} from "@/lib/invite";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * The page an invitation link opens.
 *
 * Three different people arrive here and each needs something different:
 *
 * - **No account.** Sent straight to sign-up, which shows the invitation as a
 *   banner. Stopping them here to press Accept would be a screen whose only
 *   action means "continue" — they cannot join until there is an account to
 *   join as. Declining is still offered, and needs no account: making one in
 *   order to say no is absurd.
 * - **Signed in, opened the link.** Asked. The link is not bound to an address,
 *   so whichever account is signed in is the one that joins, and Tangram has no
 *   "leave workspace" — silently joining the wrong account is not undoable.
 * - **Signed in, just came back from sign-up** (`?accept=1`). Accepted without
 *   asking again. They already answered by signing up for this.
 *
 * Acceptance is a POST the page makes, never the navigation itself. Slack,
 * Outlook Safe Links and corporate mail scanners fetch URLs to build previews;
 * a GET that joins would be spent before the human ever clicked.
 */
export function InviteView({ token, autoAccept }: { token: string; autoAccept: boolean }) {
  const router = useRouter();
  const { user, loading, getToken } = useAuth();

  const [offer, setOffer] = useState<InvitationOfferResponse | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; gone: boolean } | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"joined" | "declined" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // No auth token: the offer is anonymous by design, and sending one would
        // make this fail for the signed-out reader it exists for.
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
      // Declining needs no account, so no token is sent for it -- see the
      // controller. Accepting has to know who is joining.
      await api.post(
        `/invitations/${token}/${action}`,
        action === "accept" ? await getToken() : null
      );
      setOutcome(action === "accept" ? "joined" : "declined");
    } catch (err) {
      setActionError(
        friendlyError(err, action === "accept" ? "accept this" : "decline this").message
      );
      // A 409 means the invitation moved on under us -- expired, or used in
      // another tab. Re-reading turns a dead button into the right explanation.
      if (err instanceof ApiError && err.status === 409) reload();
    } finally {
      setBusy(null);
    }
  }

  const pending = offer?.status === "pending";
  const signedIn = !loading && user !== null;

  // Sending someone without an account to sign-up, and accepting on the way back
  // from it, are both redirects -- they run once, from an effect, and are
  // latched so a re-render can't fire them twice.
  const redirected = useRef(false);
  useEffect(() => {
    if (!pending || loading || redirected.current) return;

    if (!user) {
      redirected.current = true;
      router.replace(buildInviteSignupPath(token));
      return;
    }

    if (autoAccept) {
      redirected.current = true;
      // Arriving *is* the trigger -- there is no interaction to hang this on,
      // which is the whole point of the flag. Latched by the ref above, so it
      // cannot cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void respond("accept");
    }
    // respond is stable enough for this: it closes over state that cannot have
    // changed before the one run this is latched to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, loading, user, autoAccept, token, router]);

  // Landing after `?accept=1` goes to the board rather than a result screen.
  // They just signed up in order to join; being told they joined is a page
  // between them and the thing they came for.
  useEffect(() => {
    if (outcome === "joined" && autoAccept) router.replace("/board");
  }, [outcome, autoAccept, router]);

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
            <Loading />
          ) : loadError ? (
            <LoadFailed error={loadError} signedIn={signedIn} onRetry={reload} />
          ) : outcome === "declined" ? (
            <Declined offer={offer!} signedIn={signedIn} />
          ) : outcome === "joined" ? (
            <Joined offer={offer!} email={user?.email ?? null} token={token} />
          ) : !pending ? (
            <Offer offer={offer!}>
              <StaleOffer status={offer!.status} workspaceName={offer!.workspaceName} />
            </Offer>
          ) : loading || !user || (autoAccept && busy === "accept") ? (
            // Signed-out visitors and the post-sign-up return are both mid-flight
            // by the time this renders; showing the offer would flash a screen
            // they are already being moved past.
            <Loading label={user ? "Joining…" : "Checking your session…"} />
          ) : (
            <Offer offer={offer!}>
              <p className="text-xs text-text-dim mb-5">
                This invitation expires {expiresIn(offer!.expiresAt)}.
              </p>

              {actionError && (
                <p role="alert" className="text-xs text-danger mb-3">
                  {actionError}
                </p>
              )}

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

              {user?.email && (
                <p className="text-[11px] text-text-dim mt-3">
                  Joining as {user.email}.{" "}
                  <Link href={buildInviteLoginPath(token)} className="text-accent hover:underline">
                    Use a different account
                  </Link>
                </p>
              )}
            </Offer>
          )}
        </div>
      </div>
    </div>
  );
}

function Loading({ label = "Loading this invitation…" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-7 w-56 rounded" />
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

// The heading and the what-you-are-being-offered line, shared by every state
// that has an offer to describe.
function Offer({
  offer,
  children,
}: {
  offer: InvitationOfferResponse;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-[fade-up_0.25s_ease-out]">
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
        Join {offer.workspaceName}?
      </h2>
      <p className="text-[13px] text-text-muted mb-6">
        {offer.invitedByName} invited you as{" "}
        {offer.role === "Editor" || offer.role === "Owner" ? "an" : "a"}{" "}
        <span className="font-medium text-text">{offer.role}</span>. {ROLE_MEANS[offer.role]}
      </p>
      {children}
    </div>
  );
}

function Joined({
  offer,
  email,
  token,
}: {
  offer: InvitationOfferResponse;
  email: string | null;
  token: string;
}) {
  return (
    <div className="animate-[fade-up_0.25s_ease-out]">
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
        You&apos;re in.
      </h2>
      {/* Which account joined, stated rather than assumed. The link is not bound
          to an address, and there is no "leave workspace" yet, so getting this
          wrong is not something someone can undo themselves. */}
      <p className="text-[13px] text-text-muted mb-6">
        You joined <span className="font-medium text-text">{offer.workspaceName}</span> as{" "}
        {offer.role === "Editor" || offer.role === "Owner" ? "an" : "a"} {offer.role}
        {email ? (
          <>
            , as <span className="font-medium text-text">{email}</span>
          </>
        ) : null}
        .
      </p>
      <div className="flex flex-col gap-2">
        <Link href="/board" className="text-[13px] text-accent font-medium hover:underline">
          Open the board →
        </Link>
        {email && (
          <p className="text-[11px] text-text-dim">
            Wrong account?{" "}
            <Link href={buildInviteLoginPath(token)} className="text-accent hover:underline">
              Sign in as someone else
            </Link>{" "}
            — an owner can remove this one from the members page.
          </p>
        )}
      </div>
    </div>
  );
}

function Declined({
  offer,
  signedIn,
}: {
  offer: InvitationOfferResponse;
  signedIn: boolean;
}) {
  return (
    <div className="animate-[fade-up_0.25s_ease-out]">
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">Turned down.</h2>
      <p className="text-[13px] text-text-muted mb-6">
        You haven&apos;t joined {offer.workspaceName}, and {offer.invitedByName} can invite you
        again if this was a mistake.
      </p>
      <GoBack signedIn={signedIn} />
    </div>
  );
}

function LoadFailed({
  error,
  signedIn,
  onRetry,
}: {
  error: { message: string; gone: boolean };
  signedIn: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="animate-[fade-up_0.25s_ease-out]">
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">
        {error.gone ? "That link doesn't work." : "Couldn't load this."}
      </h2>
      <p role="alert" className="text-[13px] text-text-muted mb-6">
        {error.message}
      </p>
      {/* S3.2: a next action, not just a diagnosis. Whose fault it is decides
          which one is useful -- retrying a 404 fails again by definition. */}
      {error.gone ? (
        <>
          <p className="text-[13px] text-text-muted mb-6">
            Ask whoever invited you to send a fresh link from their members page.
          </p>
          <GoBack signedIn={signedIn} />
        </>
      ) : (
        <Button onClick={onRetry}>Try again</Button>
      )}
    </div>
  );
}

// Split out so the three dead ends read as one shape: what happened, and the one
// thing that would fix it.
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

// Where "back" is depends on whether there is an account to go back to. Sending
// a signed-out visitor to /board would bounce them to /login anyway, one flash
// of the wrong page later.
function GoBack({ signedIn }: { signedIn: boolean }) {
  return (
    <Link
      href={signedIn ? "/board" : "/login"}
      className="text-[13px] text-accent font-medium hover:underline"
    >
      {signedIn ? "Go to your boards →" : "Go to sign in →"}
    </Link>
  );
}
