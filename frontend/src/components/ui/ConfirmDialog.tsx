"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onResolve,
}: ConfirmOptions & { onResolve: (confirmed: boolean) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const cancel = useCallback(() => onResolve(false), [onResolve]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Destructive dialogs focus Cancel, so a reflexive Enter doesn't carry out
    // the damage. Everything else focuses the primary action.
    (tone === "danger" ? cancelRef : confirmRef).current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }

      // Only two focusable controls, so containment is just a two-way cycle --
      // enough to stop Tab escaping to the page behind the overlay.
      if (e.key === "Tab") {
        e.preventDefault();
        const [a, b] = [cancelRef.current, confirmRef.current];
        if (!a || !b) return;
        (document.activeElement === a ? b : a).focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [tone, cancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={cancel} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        className="relative w-full max-w-[400px] rounded-xl border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.18s_ease-out]"
      >
        <div className="px-5 pt-5 pb-4 flex flex-col gap-1.5">
          <h2 id={titleId} className="text-[15px] font-semibold leading-snug">
            {title}
          </h2>
          {body && (
            <p id={bodyId} className="text-[13px] text-text-muted leading-relaxed">
              {body}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-surface-2">
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={cancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            size="sm"
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Promise-based so call sites read like the window.confirm they replace:
//
//   if (!(await confirm({ title: "Remove Sara?", tone: "danger" }))) return;
//
// which keeps handlers flat instead of splintering each action into an
// "intent" state plus a separate committing callback.
export function useConfirm() {
  const [request, setRequest] = useState<{
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ options, resolve })),
    []
  );

  const dialog = request ? (
    <ConfirmDialog
      {...request.options}
      onResolve={(confirmed) => {
        setRequest(null);
        request.resolve(confirmed);
      }}
    />
  ) : null;

  return { confirm, dialog };
}
