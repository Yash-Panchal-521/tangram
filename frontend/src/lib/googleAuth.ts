import { GoogleAuthProvider, getAdditionalUserInfo, signInWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Google sign-in, shared by both auth routes.
 *
 * The backend needs nothing for this. It validates Firebase ID tokens against
 * the project's issuer and public keys, which is provider-agnostic, and
 * `CurrentUserLoader` reads `user_id`, `email` and `name` — all three of which a
 * Google token carries. A person who signs in this way lands in `users` by the
 * same path as everyone else.
 *
 * It does not weaken the "an email address is not a credential" invariant
 * either. Google verifies the address, but membership still comes only from
 * `POST /invitations/{token}/accept`, and the token is still the secret. Nothing
 * grants access because an address matched.
 */
export type GoogleSignInResult = {
  /** True the first time this Google account has been seen by the project. */
  isNewUser: boolean;
};

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const provider = new GoogleAuthProvider();

  // Always ask which account, rather than silently reusing the one the browser
  // happens to be signed into. People have work and personal accounts, and
  // joining the wrong workspace is not self-undoable — there is no "leave
  // workspace" yet.
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);

  // Decides /welcome versus the board, and it has to come from Firebase rather
  // than from which page the button was pressed on: someone with an account can
  // arrive at /signup and press "Continue with Google", and sending them to a
  // first-run flow they finished months ago would be wrong.
  return { isNewUser: getAdditionalUserInfo(credential)?.isNewUser ?? false };
}
