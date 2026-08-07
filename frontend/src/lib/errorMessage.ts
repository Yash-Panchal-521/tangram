import { ApiError } from "@/lib/api";

export interface FriendlyError {
  /** What the user sees. Names their next action, never the infrastructure (S3.1, S3.2). */
  message: string;
  /** Whether trying the same thing again could plausibly work. Drives the retry affordance (S3.5). */
  canRetry: boolean;
}

/**
 * One place that turns a thrown error into something worth showing a person.
 *
 * Before this, failures either vanished silently or surfaced raw protocol —
 * "GET /workspaces failed with 502" — and three surfaces asked the user whether
 * the backend was running, which they cannot act on and which was usually the
 * wrong cause anyway.
 */
export function friendlyError(error: unknown, fallbackAction = "do that"): FriendlyError {
  if (error instanceof ApiError) {
    // 4xx: the server has an opinion, and for 400 it is usually a rule worth
    // repeating verbatim — "a workspace must keep at least one owner".
    if (error.status === 400 && hasHumanDetail(error.message)) {
      return { message: error.message, canRetry: false };
    }

    switch (error.status) {
      case 401:
        return { message: "Your session has expired. Sign in again to continue.", canRetry: false };
      case 403:
        return {
          message: `You don't have permission to ${fallbackAction}. Ask an owner for access.`,
          canRetry: false,
        };
      case 404:
        return {
          message: "That's no longer here — someone may have just deleted it.",
          canRetry: false,
        };
      case 409:
        return {
          message: "Someone else changed this first. Refresh to see the latest.",
          canRetry: false,
        };
      case 429:
        return { message: "Too many changes at once. Wait a moment and try again.", canRetry: true };
    }

    // 502/503/504 on this deployment nearly always means the free-tier API is
    // waking from its 15-minute sleep, which resolves itself in under a minute.
    if (error.status >= 500) {
      return {
        message: "The server is waking up. This takes up to a minute — try again shortly.",
        canRetry: true,
      };
    }

    return { message: `Couldn't ${fallbackAction}. Try again.`, canRetry: true };
  }

  // fetch() rejects with a TypeError when the request never reached a server:
  // offline, DNS failure, connection refused.
  if (error instanceof TypeError) {
    return {
      message: "Can't reach Tangram. Check your connection and try again.",
      canRetry: true,
    };
  }

  return { message: `Couldn't ${fallbackAction}. Try again.`, canRetry: true };
}

/**
 * ValidationProblemDetails sometimes carries a real sentence and sometimes a
 * framework string like "One or more validation errors occurred." Only the
 * former is worth showing (S3.4).
 */
function hasHumanDetail(message: string): boolean {
  if (!message || message.startsWith("One or more validation errors")) return false;
  // The generated fallback in api.ts looks like "POST /workspaces failed with 400".
  return !/^[A-Z]+ \/\S* failed with \d+$/.test(message);
}
