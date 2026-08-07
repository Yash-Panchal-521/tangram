"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { authInputClasses, friendlyAuthError, MIN_PASSWORD_LENGTH } from "@/lib/authForm";
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
      router.replace("/board");
    }
  }, [loading, user, router]);

  // Seeds the address from an invite link (/signup?email=…). More than a
  // convenience: invitations are claimed by exact normalised email, so someone
  // who signs up with a different address silently never joins the workspace
  // they were invited to.
  //
  // Read from window rather than useSearchParams() — the hook would force this
  // statically prerendered route to become dynamic, or demand a Suspense
  // boundary, neither of which is worth restructuring the page for. Costs one
  // tick of empty field.
  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get("email");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (invited) setEmail(invited.trim().toLowerCase());
  }, []);

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

      router.replace("/board");
    } catch (err) {
      setError(friendlyAuthError(err));
      signingUpRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      headline={
        <>
          Start building,
          <br />
          together.
        </>
      }
      subhead="Create an account to join a workspace or start your own. Invitations waiting on your email are picked up automatically."
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
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">Create your account.</h2>
      <p className="text-[13px] text-text-muted mb-8">Takes about ten seconds.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 mb-4">
        <AuthField id={nameId} label="Full name">
          <input
            id={nameId}
            type="text"
            placeholder="Ada Lovelace"
            autoComplete="name"
            autoFocus
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={authInputClasses}
          />
        </AuthField>

        <AuthField id={emailId} label="Email">
          <input
            id={emailId}
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClasses}
          />
        </AuthField>

        <AuthField
          id={passwordId}
          label="Password"
          hint={
            <PasswordRule met={passwordLongEnough}>
              At least {MIN_PASSWORD_LENGTH} characters
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
          {submitting ? "Creating account…" : "Create account →"}
        </Button>
      </form>

      <p className="text-[13px] text-text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
