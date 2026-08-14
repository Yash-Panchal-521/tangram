import { FirebaseError } from "firebase/app";

// Shared by the sign-in and sign-up forms so the two panels stay identical
// without either page owning the other's styling.
// Underline, not a box (v7). A boxed field draws four lines to say "type here"
// when one will do, and on a form of three fields the boxes end up carrying more
// visual weight than the words. The rule sits on `--border` and moves to
// `--accent` on focus, so the focus state is the line thickening in colour
// rather than a ring appearing around a shape.
//
// `rounded-none` is deliberate: with a bottom border only there is nothing for a
// radius to round, and leaving one on produced a 2px nick at each end.
// Focus is the rule thickening, not a ring appearing.
//
// The app-wide focus ring is `box-shadow: 0 0 0 3px var(--ring)` on a rounded
// rectangle, which is right for a boxed field and wrong here: it drew a box
// around a field that deliberately has none. These opt out with
// `data-focus-ring="none"` — which has to be an attribute, because that rule is
// unlayered in globals.css and outranks any utility (S1.3's cousin).
//
// The replacement is an inset shadow along the bottom edge rather than
// `border-b-2`, so the underline doubles in weight without the extra pixel
// pushing the field's contents up.
export const authInputClasses =
  "w-full py-2.5 px-0 bg-transparent border-0 border-b border-border rounded-none text-[15px] text-text placeholder:text-text-dim transition-colors focus-visible:border-accent focus-visible:shadow-[inset_0_-1px_0_0_var(--accent)]";

// Firebase's own floor. Named rather than inlined so the hint shown to the user,
// the input's minLength and the submit guard can't drift from each other -- the
// failure mode being a form that promises one rule and enforces another.
export const MIN_PASSWORD_LENGTH = 6;

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
