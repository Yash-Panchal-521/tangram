"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Avatar } from "@/components/ui/Avatar";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const { mode, toggleMode } = useTheme();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Fixed-position coordinates measured from the trigger. Both page shells are
  // `overflow-hidden`, so an absolutely positioned dropdown inside the header
  // gets clipped; fixed escapes the clip without needing a portal.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const openMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }
    // The anchor is measured once on open, so anything that moves the trigger
    // would leave the menu stranded. Closing is simpler and less jarring than
    // recomputing mid-scroll.
    function onReflow() {
      close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close]);

  if (!user) return null;

  const name = user.displayName ?? user.email ?? "You";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // signOut navigates away, but if it throws we must not leave the button
      // stuck on "Signing out…" with the menu open.
      setSigningOut(false);
      close();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="rounded-full cursor-pointer hover:opacity-85 transition-opacity"
      >
        <Avatar name={name} size="sm" />
      </button>

      {open && anchor && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: anchor.top, right: anchor.right }}
          className="fixed z-50 w-[220px] rounded-lg border border-border bg-surface shadow-lg overflow-hidden animate-[fade-up_0.15s_ease-out]"
        >
          <div className="px-3.5 py-3 border-b border-border">
            <p className="text-[13px] font-medium truncate">{name}</p>
            {user.email && (
              <p className="text-xs text-text-muted truncate mt-0.5">{user.email}</p>
            )}
          </div>

          {/* Theme is a personal preference, not a board action, so it belongs
              with the account rather than taking a slot in a header that was
              already carrying seven clusters. The standalone ThemeToggle stays
              for the signed-out pages, which have no account menu. */}
          <button
            role="menuitem"
            onClick={toggleMode}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-text hover:bg-surface-2 transition-colors cursor-pointer border-b border-border"
          >
            {mode === "dark" ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.5" fill="currentColor" />
                <path
                  d="M7 1.5V3M7 11V12.5M1.5 7H3M11 7H12.5M3.2 3.2L4.2 4.2M9.8 9.8L10.8 10.8M10.8 3.2L9.8 4.2M4.2 9.8L3.2 10.8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M11.2 8.8A5 5 0 015.2 2.8 5 5 0 1011.2 8.8z" fill="currentColor" />
              </svg>
            )}
            {mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          </button>

          <button
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] text-text hover:bg-surface-2 hover:text-danger transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M5.5 12.5H2.75a1 1 0 01-1-1v-9a1 1 0 011-1H5.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 9.5L12.5 7 9.5 4.5M12.5 7H5.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </>
  );
}
