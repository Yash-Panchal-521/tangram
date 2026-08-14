"use client";

import { useState } from "react";
import { friendlyGoogleError } from "@/lib/authForm";
import { signInWithGoogle } from "@/lib/googleAuth";

/**
 * The divider and Google button from the v7 auth screen.
 *
 * One component rather than two, because the rule and the "or" only make sense
 * with something under them — a divider above nothing is a line that ends the
 * form for no reason.
 */
export function GoogleSignIn({
  onSignedIn,
  disabled,
}: {
  /** Given `isNewUser` so the caller can route to first-run or to the board. */
  onSignedIn: (isNewUser: boolean) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setBusy(true);
    try {
      const { isNewUser } = await signInWithGoogle();
      onSignedIn(isNewUser);
    } catch (err) {
      // null means the person closed the popup, which is a decision rather than
      // a failure and gets no message.
      const message = friendlyGoogleError(err);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 my-5">
        <span className="flex-1 h-px bg-border" />
        <span className="text-[10px] uppercase tracking-[0.12em] text-text-dim">or</span>
        <span className="flex-1 h-px bg-border" />
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy}
        className="w-full py-3 border border-border rounded-md text-[13.5px] text-text-muted text-center transition-colors cursor-pointer hover:border-text-dim hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Opening Google…" : "Continue with Google"}
      </button>

      {/* Its own surface, next to the control that produced it — a popup failure
          has nothing to do with the email field's error, and putting both in one
          slot means whichever came last wins (S3.2). */}
      {error && (
        <p role="alert" className="mt-2.5 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}
