"use client";

import { useEffect, useState } from "react";
import { api, type InvitationOfferResponse } from "@/lib/api";

/**
 * The `?invite=` token on an auth page, and the offer it names.
 *
 * Read from `window.location` rather than `useSearchParams()`, matching the rest
 * of these routes: the hook would force a statically prerendered page to become
 * dynamic or demand a Suspense boundary, for one query parameter.
 *
 * A failed or already-spent invitation resolves to a null offer and is simply
 * not shown. Sign-up still works — someone who lands here with a dead link
 * should be able to make an account, not hit a wall on a page that was never
 * about the invitation.
 */
export function useInviteOffer(): {
  token: string | null;
  offer: InvitationOfferResponse | null;
} {
  const [token, setToken] = useState<string | null>(null);
  const [offer, setOffer] = useState<InvitationOfferResponse | null>(null);

  useEffect(() => {
    const found = new URLSearchParams(window.location.search).get("invite");
    if (!found) return;

    let cancelled = false;

    // Set before the fetch, not after: a signed-in visitor is redirected the
    // moment the session resolves, and that redirect needs the token. Waiting
    // for the offer would bounce them to /board and lose the invitation.
    //
    // The rule guards against cascading renders. This runs once, on mount, off
    // a URL that cannot change without a navigation -- the same exception the
    // auth pages take for their own query parameters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(found);

    (async () => {
      try {
        const data = await api.get<InvitationOfferResponse>(`/invitations/${found}`, null);
        if (!cancelled && data.status === "pending") setOffer(data);
      } catch {
        // Deliberately silent: the banner is context, not the task. An invalid
        // token is explained by the invite page, which is where someone who
        // cares about it will end up.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { token, offer };
}
