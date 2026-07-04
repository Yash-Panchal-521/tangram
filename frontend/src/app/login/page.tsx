"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { TangramMark } from "@/components/ui/TangramMark";

function friendlyError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Incorrect email or password.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/too-many-requests":
        return "Too many attempts. Try again in a moment.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

const inputClasses =
  "w-full py-2.5 px-3.5 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim transition-colors focus-visible:border-accent";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/board");
    }
  }, [loading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace("/board");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left brand panel */}
      <div className="w-[420px] shrink-0 bg-accent relative hidden md:flex flex-col py-11 px-12 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="absolute -right-11 -bottom-6 opacity-[0.07] pointer-events-none">
          <TangramMark size={380} color="white" />
        </div>

        <div className="flex items-center gap-2.5 relative shrink-0">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <TangramMark size={18} color="white" />
          </div>
          <span className="text-base font-semibold text-white tracking-tight">Tangram</span>
        </div>

        <div className="flex-1 flex flex-col justify-center relative py-10">
          <h1 className="text-4xl font-semibold text-white tracking-tight leading-[1.05] mb-4">
            Ship faster,
            <br />
            together.
          </h1>
          <p className="text-[13px] text-white/65 leading-relaxed mb-9">
            Multi-tenant real-time kanban for engineering teams. RBAC, live cursors,
            offline-tolerant sync.
          </p>
          <div className="flex flex-col gap-3">
            {[
              "Real-time cursor presence",
              "Owner / Editor / Viewer RBAC",
              "Offline-tolerant sync",
            ].map((line) => (
              <div key={line} className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-white/[0.18] flex items-center justify-center shrink-0">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 5L3.8 7.5L8.5 2.5"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <span className="text-[13px] text-white/85">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 bg-bg relative flex flex-col items-center justify-center p-12 overflow-y-auto">
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[360px] animate-[fade-up_0.25s_ease-out]">
          <h2 className="text-[26px] font-semibold tracking-tight mb-1.5">Welcome back.</h2>
          <p className="text-[13px] text-text-muted mb-8">Sign in to continue to Tangram.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 mb-4">
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
            />
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full mt-1">
              {submitting ? "Signing in…" : "Sign in →"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
