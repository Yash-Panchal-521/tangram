import { FirebaseError } from "firebase/app";

// Shared by the sign-in and sign-up forms so the two panels stay identical
// without either page owning the other's styling.
export const authInputClasses =
  "w-full py-2.5 px-3.5 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-dim transition-colors focus-visible:border-accent";

// Firebase error codes are precise but user-hostile; this maps the ones either
// form can realistically produce onto something a person can act on.
export function friendlyAuthError(error: unknown): string {
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
      case "auth/email-already-in-use":
        return "That email already has an account. Try signing in instead.";
      case "auth/weak-password":
        return "Choose a password of at least 6 characters.";
      case "auth/operation-not-allowed":
        return "Email/password sign-in isn't enabled for this project.";
      case "auth/network-request-failed":
        return "Network problem. Check your connection and try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
