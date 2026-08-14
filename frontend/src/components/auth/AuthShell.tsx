import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

/**
 * The page frame both auth routes share, including the session check.
 *
 * `checking` is the state that was missing (S2.1). Firebase resolves the stored
 * session asynchronously, so both pages used to render a full sign-in form to
 * someone who was already signed in, then redirect out from under them — the
 * form flashed up as if their session had been lost.
 */
export function AuthShell({
  headline,
  subhead,
  checking,
  children,
}: {
  headline: React.ReactNode;
  subhead: string;
  checking: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex overflow-hidden">
      <AuthBrandPanel headline={headline} subhead={subhead} />

      <div className="flex-1 basis-[54%] bg-bg relative flex flex-col items-center justify-center p-10 overflow-y-auto">
        <div className="absolute top-5 right-5 z-10">
          <ThemeToggle />
        </div>

        {checking ? (
          <div
            role="status"
            aria-busy="true"
            className="w-full max-w-[346px] flex flex-col items-center gap-2 text-center"
          >
            <p className="text-sm text-text-muted">Checking your session…</p>
            <p className="text-xs text-text-dim">
              If you&apos;re already signed in, we&apos;ll take you straight to your board.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-[346px] animate-[fade-up_0.25s_ease-out]">{children}</div>
        )}
      </div>
    </div>
  );
}
