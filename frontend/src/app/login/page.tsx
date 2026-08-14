"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { authInputClasses, friendlyAuthError } from "@/lib/authForm";
import { buildInviteSignupPath, safeNextPath } from "@/lib/invite";
import { InviteBanner } from "@/components/invite/InviteBanner";
import { useInviteOffer } from "@/components/invite/useInviteOffer";
import { AuthField } from "@/components/auth/AuthField";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // See the signup page: an invite link sends people through here, and they
  // have to come back to it rather than being dropped on a board.
  const [next, setNext] = useState("/board");

  const { token: inviteToken, offer } = useInviteOffer();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNext(safeNextPath(new URLSearchParams(window.location.search).get("next"), "/board"));
  }, []);

  // Back to the invitation to *decide*, never to auto-accept -- unlike sign-up.
  // This route is also how "use a different account" works, and someone
  // switching accounts before choosing must not find they have joined on the
  // one they switched to.
  const destination = inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : next;

  useEffect(() => {
    if (!loading && user) {
      router.replace(destination);
    }
  }, [loading, user, router, destination]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace(destination);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      headline={
        <>
          Ship faster,
          <br />
          together.
        </>
      }
      subhead="Multi-tenant real-time kanban for engineering teams. Roles, live cursors, and a board that catches itself up after a disconnect."
      // Covers both the initial resolve and the moment between a known session
      // and the redirect landing, so the form never appears to someone who is
      // on their way out of this page.
      checking={loading || user !== null}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-dim mb-1.5">Sign in</p>
      <h2
        className={`text-[31px] font-normal tracking-[-0.01em] ${offer ? "mb-2" : "mb-[26px]"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        Welcome back.
      </h2>
      {/* The design goes straight from title to fields. The subhead survives
          only where it carries something the title cannot — that you are here to
          accept an invitation, which changes what signing in means. */}
      {offer && <p className="text-[13px] text-text-muted mb-5">Sign in to accept your invitation.</p>}

      {inviteToken && offer && (
        <InviteBanner token={inviteToken} offer={offer} className="mb-5" />
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-[15px] mb-5">
        <AuthField id={emailId} label="Email">
          <input
            id={emailId}
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClasses}
          />
        </AuthField>

        {/* No "6 characters minimum" here, unlike sign-up. The design draws one
            auth screen with a flag for the extra name field, but the password
            rule only means something where a password is being *chosen* — on
            sign-in it is a rule about a password that already exists. */}
        <AuthField id={passwordId} label="Password">
          <PasswordInput
            id={passwordId}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClasses}
          />
        </AuthField>

        {/* role="alert" so a failed sign-in is announced. Without it the only
            signal is a line of red text the reader never reaches. */}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full mt-[9px]">
          {submitting ? "Signing in…" : "Sign in →"}
        </Button>
      </form>

      <p className="text-[12.5px] leading-relaxed text-text-dim">
        New to Tangram?{" "}
        <Link
          href={
            inviteToken
              ? buildInviteSignupPath(inviteToken)
              : next === "/board"
                ? "/signup"
                : `/signup?next=${encodeURIComponent(next)}`
          }
          className="text-accent font-medium hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
