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
    // Centred, not the split panel the sign-in pages use. That panel exists to
    // sell the product to someone deciding whether to join it; a person holding
    // an invitation has already been sold, and the only question on this screen
    // is whether this particular offer is the one they meant to accept. A poster
    // beside it competes with the answer.
    <div className="flex-1 bg-bg relative flex items-center justify-center p-10 overflow-y-auto">
      <div className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[520px]">
        <span className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          Tangram
        </span>

        <div className="mt-8">
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
              {actionError && (
                <p role="alert" className="text-[13px] text-danger mt-6">
                  {actionError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2.5 mt-7">
                <Button onClick={() => void respond("accept")} disabled={busy !== null}>
                  {busy === "accept" ? "Joining…" : "Accept and open workspace"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void respond("decline")}
                  disabled={busy !== null}
                >
                  {busy === "decline" ? "Declining…" : "Decline"}
                </Button>
              </div>

              {/* Which account is about to join, and the way out. The link is not
                  bound to an address and there is no "leave workspace" yet, so
                  joining as the wrong account is not self-undoable — saying the
                  invitation survives switching is what makes it safe to switch. */}
              {user?.email && (
                <p className="text-[12.5px] text-text-dim mt-4">
                  Not you? Joining as {user.email} —{" "}
                  <Link href={buildInviteLoginPath(token)} className="text-accent hover:underline">
                    sign in with another account
                  </Link>
                  , the invitation stays valid.
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
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-dim">
        Invitation · expires {expiresIn(offer.expiresAt)}
      </p>
      {/* The sentence is the headline. Naming the inviter and the workspace in
          the one line at display size answers "is this the invitation I meant
          to accept" before anything else on the screen is read. */}
      <h2
        className="mt-3.5 text-[38px] leading-[1.16] tracking-[-0.012em] text-pretty"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {offer.invitedByName} invited you to <span className="text-accent">{offer.workspaceName}</span>
      </h2>

      {/* The particulars as a property list under a rule in --text, so what you
          are agreeing to is scannable rather than buried in the paragraph the
          headline used to carry. */}
      <dl className="mt-8 border-t border-text">
        <OfferRow k="From" v={offer.invitedByName} />
        <OfferRow k="Workspace" v={offer.workspaceName} />
        <OfferRow k="Role" v={offer.role} note={ROLE_MEANS[offer.role]} />
      </dl>

      {children}
    </div>
  );
}

/** One `118px | rest` row of the offer's property list. */
function OfferRow({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div
      className="grid gap-4 py-3.5 border-b border-border-2"
      style={{ gridTemplateColumns: "118px minmax(0,1fr)" }}
    >
      <dt className="pt-0.5 text-[10px] uppercase tracking-[0.11em] text-text-dim">{k}</dt>
      <dd className="min-w-0">
        <span className="text-sm">{v}</span>
        {note && <span className="block mt-1 text-[12.5px] text-text-dim">{note}</span>}
      </dd>
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
