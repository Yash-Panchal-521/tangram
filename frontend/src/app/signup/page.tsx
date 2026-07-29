"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { authInputClasses, friendlyAuthError } from "@/lib/authForm";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function SignupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <AuthBrandPanel
        headline={
          <>
            Start building,
            <br />
            together.
          </>
        }
        subhead="Create an account to join a workspace or start your own. Invitations waiting on your email are picked up automatically."
      />

      <div className="flex-1 bg-bg relative flex flex-col items-center justify-center p-12 overflow-y-auto">
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[360px] animate-[fade-up_0.25s_ease-out]">
          <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">Create your account.</h2>
          <p className="text-[13px] text-text-muted mb-8">Takes about ten seconds.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 mb-4">
            <input
              type="text"
              placeholder="Full name"
              autoComplete="name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={authInputClasses}
            />
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClasses}
            />
            <PasswordInput
              placeholder="Password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClasses}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full mt-1">
              {submitting ? "Creating account…" : "Create account →"}
            </Button>
          </form>

          <p className="text-[13px] text-text-muted">
            Already have an account?{" "}
            <Link href="/login" className="text-accent font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
