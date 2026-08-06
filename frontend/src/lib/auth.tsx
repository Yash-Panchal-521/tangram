"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

// Mirrors the key in app/board/page.tsx. Cleared on sign-out so the next person
// to use this browser doesn't inherit a pointer to someone else's board -- the
// landing page validates it against the server anyway, but leaving it behind
// leaks which board the previous user had open.
const BOARD_ID_KEY = "tangram-board-id";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  getToken: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const getToken = useCallback(
    async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    []
  );

  // Navigation lives here rather than at each call site: not every page reacts
  // to the user going null on its own, and a sign-out that leaves you sitting
  // on a board you can no longer load is worse than no sign-out at all.
  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem(BOARD_ID_KEY);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies); never let
      // that stop the actual sign-out.
    }
    await firebaseSignOut(auth);
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, getToken, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
