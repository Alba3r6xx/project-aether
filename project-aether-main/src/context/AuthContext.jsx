'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  getSession,
  onAuthStateChange,
  signIn as signInRequest,
  signUp as signUpRequest,
  signOut as signOutRequest,
} from '../services/authService';
import { invalidateOrgIdCache } from '../services/historyService';
import { IS_SUPABASE_CONFIGURED } from '../services/config';

const AuthContext = createContext(null);

/**
 * Wraps the whole app (see app/layout.jsx's providers) and exposes the
 * current auth session plus sign in/up/out actions via useAuth(). Also
 * tracks whether Supabase is configured at all, so pages can decide
 * whether to enforce login or just show a "connect Supabase" notice.
 *
 * In the Next.js App Router this Provider component must itself be a
 * Client Component ('use client' above) - it's mounted from the root
 * layout via <Providers>, keeping the layout itself a Server Component.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSession()
      .then((s) => {
        if (mounted) setSession(s);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    const unsubscribe = onAuthStateChange((s) => {
      if (mounted) setSession(s);
      // When the session is cleared (sign-out, token expiry), bust the
      // org-id cache so the next sign-in fetches a fresh org id.
      if (!s) invalidateOrgIdCache();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function signIn(credentials) {
    const data = await signInRequest(credentials);
    setSession(data.session);
    return data;
  }

  async function signUp(details) {
    const data = await signUpRequest(details);
    if (data.session) setSession(data.session);
    return data;
  }

  async function signOut() {
    await signOutRequest();
    setSession(null);
    // Bust the org-id cache so a different user signing in doesn't reuse it.
    invalidateOrgIdCache();
  }

  const value = {
    session,
    user: session?.user ?? null,
    isAuthenticated: Boolean(session),
    isLoading,
    isSupabaseConfigured: IS_SUPABASE_CONFIGURED,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
