import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_SUPABASE_CONFIGURED } from './config';

/**
 * Server-side Supabase client for use inside Server Components, Route
 * Handlers, and Server Actions. Reads/writes the same auth cookies the
 * browser client (supabaseClient.js) and middleware (src/middleware.js)
 * use, so a session established on the client is visible here and vice
 * versa.
 *
 * Returns `null` when Supabase isn't configured, mirroring the browser
 * client's behaviour so Server Components can fall back to mock data too.
 */
export async function createServerSupabaseClient() {
  if (!IS_SUPABASE_CONFIGURED) return null;

  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            // AUDIT C6: enforce SameSite=Lax for CSRF protection.
            cookieStore.set(name, value, { ...options, sameSite: 'lax' })
          );
        } catch {
          // Called from a Server Component where cookies can't be mutated.
          // The middleware refresh will pick this up on the next request.
        }
      },
    },
  });
}
