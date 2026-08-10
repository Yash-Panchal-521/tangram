"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { authInputClasses, friendlyAuthError } from "@/lib/authForm";
import { safeNextPath } from "@/lib/invite";
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNext(safeNextPath(new URLSearchParams(window.location.search).get("next"), "/board"));
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [loading, user, router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace(next);
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
      <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">Welcome back.</h2>
      <p className="text-[13px] text-text-muted mb-8">Sign in to continue to Tangram.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 mb-4">
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

        <Button type="submit" disabled={submitting} className="w-full mt-1">
          {submitting ? "Signing in…" : "Sign in →"}
        </Button>
      </form>

      <p className="text-[13px] text-text-muted">
        New to Tangram?{" "}
        <Link
          href={next === "/board" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
          className="text-accent font-medium hover:underline"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
