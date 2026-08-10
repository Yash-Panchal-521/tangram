"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type InvitationOfferResponse } from "@/lib/api";
import { friendlyError } from "@/lib/errorMessage";
import { ROLE_MEANS } from "@/lib/invite";

/**
 * The invitation, shown on the sign-up and sign-in pages someone reached from a
 * link.
 *
 * This is the context the old interstitial carried. Dropping a stranger onto a
 * bare sign-up form removes the reason they were signing up — "Join Acme Team?
 * Dean invited you as an Editor" is exactly what makes making an account worth
 * doing. So the screen goes, the explanation stays.
 *
 * Declining lives here too, and takes no account: requiring someone to register
 * before they can refuse would be the opposite of the point.
 */
export function InviteBanner({
  token,
  offer,
  className,
}: {
  token: string;
  offer: InvitationOfferResponse;
  className?: string;
}) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const article = offer.role === "Editor" || offer.role === "Owner" ? "an" : "a";

  async function decline() {
    setDeclining(true);
    setError(null);
    try {
      // Anonymous by design -- see InvitationsController.Decline. A POST, not a
      // link, so a mail scanner fetching the URL can't refuse on someone's
      // behalf.
      await api.post(`/invitations/${token}/decline`, null);
      // The invite page reads the status back and renders the turned-down state,
      // rather than this banner growing a second identity.
      router.replace(`/invite/${encodeURIComponent(token)}`);
    } catch (err) {
      setDeclining(false);
      setError(friendlyError(err, "decline this").message);
    }
  }

  return (
    <div
      className={`rounded-lg border border-accent/40 bg-surface p-3.5 flex flex-col gap-1.5 ${className ?? ""}`}
    >
      <p className="text-[13px]">
        Joining <span className="font-medium">{offer.workspaceName}</span> as {article}{" "}
        <span className="font-medium">{offer.role}</span>, invited by {offer.invitedByName}.
      </p>
      <p className="text-[11px] text-text-muted">{ROLE_MEANS[offer.role]}</p>

      {error && (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}

      <p className="text-[11px] text-text-dim">
        Not you, or not interested?{" "}
        <button
          type="button"
          onClick={() => void decline()}
          disabled={declining}
          className="text-accent font-medium hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {declining ? "Declining…" : "Decline this invitation"}
        </button>
      </p>
    </div>
  );
}
