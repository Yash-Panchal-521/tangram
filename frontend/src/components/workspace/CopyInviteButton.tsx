"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { buildInviteMessage } from "@/lib/invite";

const COPIED_RESET_MS = 2000;

// Since nothing emails the invitee, this is the only thing that actually gets
// the invitation to them. Lives next to fresh invite results and on every
// pending row, so it's re-copyable days later without re-inviting.
export function CopyInviteButton({
  email,
  workspaceName,
  label = "Copy invite",
  className,
}: {
  email: string;
  workspaceName: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Pre-select the fallback text so the user only has to press Ctrl+C.
  useEffect(() => {
    if (fallbackText) fallbackRef.current?.select();
  }, [fallbackText]);

  async function handleCopy() {
    const message = buildInviteMessage({
      workspaceName,
      email,
      // Read at click time, so the link matches wherever the app is served
      // from rather than a build-time guess.
      origin: window.location.origin,
    });

    try {
      await navigator.clipboard.writeText(message);
      setFallbackText(null);
      setCopied(true);
    } catch {
      // clipboard requires a secure context and permission. Rather than fail
      // silently, show the text so it can still be copied by hand.
      setFallbackText(message);
    }
  }

  return (
    <div className={className}>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        title={`Copy an invitation message for ${email}`}
        className="shrink-0"
      >
        {copied ? "Copied ✓" : label}
      </Button>

      {fallbackText && (
        <div className="mt-1.5 flex flex-col gap-1">
          <p className="text-[11px] text-warn">
            Couldn&apos;t reach the clipboard — copy this manually:
          </p>
          <textarea
            ref={fallbackRef}
            readOnly
            rows={5}
            value={fallbackText}
            onClick={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-border bg-bg p-2 text-[11px] text-text-muted resize-none outline-none focus-visible:border-accent"
          />
        </div>
      )}
    </div>
  );
}
