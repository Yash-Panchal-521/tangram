"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { authInputClasses, friendlyAuthError, MIN_PASSWORD_LENGTH } from "@/lib/authForm";
import { buildInviteLoginPath, buildInviteReturnPath, safeNextPath } from "@/lib/invite";
import { InviteBanner } from "@/components/invite/InviteBanner";
import { useInviteOffer } from "@/components/invite/useInviteOffer";
import { AuthField, PasswordRule } from "@/components/auth/AuthField";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function SignupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // An explicitly requested destination, or null when nobody asked for one.
  // Someone who arrived from an invite link has to be returned to it -- signing
  // up is a detour they took to accept, and dropping them on a board they aren't
  // in yet loses the invitation entirely.
  const [next, setNext] = useState<string | null>(null);

  const { token: inviteToken, offer } = useInviteOffer();

  // Set synchronously at the top of handleSubmit, before any await, so it is
  // already true by the time Firebase notifies the auth listener below.
  const signingUpRef = useRef(false);

  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH;

  useEffect(() => {
    // Bounce visitors who are already signed in -- but not mid-sign-up.
    // `user` becomes non-null the instant the account is created, which is
    // *before* updateProfile has run. Redirecting there sends the first API
    // call with a token that carries no `name` claim, and the backend then
    // names the user after their email local part. handleSubmit navigates
    // itself once the profile is set and the token refreshed.
    if (signingUpRef.current) return;
    if (!loading && user) {
      // Already signed in and holding an invite: send them to decide, not to
      // auto-accept. Creating an account for an invitation is unambiguous
      // consent; arriving here with a session already open is not.
      //
      // Otherwise /board, not /welcome: this branch is somebody who already had
      // an account before opening this page, so whether they have a board is
      // genuinely unknown and the resolver is the right place to ask.
      router.replace(
        inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : (next ?? "/board")
      );
    }
  }, [loading, user, router, next, inviteToken]);

  // Read from window rather than useSearchParams() — the hook would force this
  // statically prerendered route to become dynamic, or demand a Suspense
  // boundary, neither of which is worth restructuring the page for. Costs one
  // tick of empty field.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNext(safeNextPath(new URLSearchParams(window.location.search).get("next"), null));
  }, []);

  // Seeds the address from the invitation itself rather than from the URL, so a
  // real person's address never travels in a query string. A convenience only:
  // the token grants membership, so signing up with a different address works.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !offer?.email) return;
    seeded.current = true;
    setEmail(offer.email);
  }, [offer?.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    signingUpRef.current = true;
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: displayName.trim() });

      // updateProfile does not invalidate the ID token that was just minted, so
      // without forcing a refresh the backend's first upsert sees no `name`
      // claim and derives the display name from the email local-part -- which
      // is what presence avatars and cursor labels would then show forever.
      await credential.user.getIdToken(true);

      // Straight to the destination, never via /board.
      //
      // /board exists to answer "which board should this person open?" by
      // fetching their workspaces -- a question with no answer for an account
      // created two lines ago. Routing through it showed a board skeleton for
      // one frame and then replaced it with the welcome screen, which reads as
      // a glitch rather than a step. This page is the one place that *knows*
      // the account is new, so it says so instead of asking.
      //
      // An invitation still goes back to the invite page, which accepts and
      // then opens the board it just joined -- also skipping /welcome, whose
      // "do you have a board?" check would offer to build a workspace to
      // somebody who has just joined one.
      router.replace(
        inviteToken ? buildInviteReturnPath(inviteToken) : (next ?? "/welcome")
      );
    } catch (err) {
      setError(friendlyAuthError(err));
      signingUpRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      headline="Work laid out in lanes, not stacked in a pile."
      subhead="Every card sits at the crossing of who holds it and where it stands. Shared live, with an operation log you can read back."
      // `submitting`, not the ref: a ref read during render doesn't re-render
      // when it changes, so the shell would keep whichever value it saw first.
      // The two flip together anyway -- setSubmitting(true) is the line above
      // signingUpRef.current = true.
      //
      // Mid-sign-up `user` is non-null while this page is still working, so the
      // form has to stay put; swapping to "Checking your session…" would hide
      // the error if account creation then failed.
      checking={loading || (user !== null && !submitting)}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-dim mb-1.5">New here</p>
      <h2
        className={`text-[31px] font-normal tracking-[-0.01em] ${offer ? "mb-2" : "mb-[26px]"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {offer ? "Create your account to join" : "Create your workspace"}
      </h2>

      {/* The context the old invitation interstitial carried. Without it this is
          a bare form, and nothing on screen says why anyone is filling it in. */}
      {inviteToken && offer && (
        <InviteBanner token={inviteToken} offer={offer} className="mb-5" />
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-[15px] mb-5">
        <AuthField id={nameId} label="Display name">
          <input
            id={nameId}
            type="text"
            placeholder="Rita Menon"
            autoComplete="name"
            autoFocus
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            data-focus-ring="none"
            className={authInputClasses}
          />
        </AuthField>

        <AuthField id={emailId} label="Email">
          <input
            id={emailId}
            type="email"
            placeholder="you@studio.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-focus-ring="none"
            className={authInputClasses}
          />
        </AuthField>

        <AuthField
          id={passwordId}
          label="Password"
          // The design puts a static "6 characters minimum" opposite the label.
          // This puts the live-ticking rule there instead: same position, same
          // job, and it also answers "have I met it yet" without a second line
          // under the field repeating the first.
          labelHint={
            <PasswordRule met={passwordLongEnough}>
              {MIN_PASSWORD_LENGTH} characters minimum
            </PasswordRule>
          }
        >
          <PasswordInput
            id={passwordId}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-focus-ring="none"
            className={authInputClasses}
          />
        </AuthField>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        {/* Disabled on the rule the server actually enforces, so the failure
            path for a short password no longer needs a round trip to reveal
            something already known here. */}
        <Button
          type="submit"
          disabled={submitting || !passwordLongEnough}
          className="w-full mt-1"
        >
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-[12.5px] leading-relaxed text-text-dim">
        Already have an account?{" "}
        {/* Carries the destination across, so switching form doesn't strand
            someone who came here from an invite link. */}
        <Link
          href={
            inviteToken
              ? buildInviteLoginPath(inviteToken)
              : next
                ? `/login?next=${encodeURIComponent(next)}`
                : "/login"
          }
          className="text-accent font-medium hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
