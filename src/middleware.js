import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_SUPABASE_CONFIGURED } from './services/config';

/**
 * Next.js middleware - runs on every matched request before the route
 * renders. Two jobs:
 *
 *  1. Refresh the Supabase auth session cookie so a logged-in user stays
 *     logged in across navigations (the @supabase/ssr pattern).
 *  2. Guard the /dashboard, /history, /analytics, /settings routes when
 *     Supabase is configured - redirect unauthenticated users to /login.
 *
 * When Supabase isn't configured (no env vars), this is a no-op so the
 * demo/mock-mode dashboard stays fully open, exactly like the original
 * Vite build's ProtectedRoute behaviour.
 */
export async function middleware(request) {
  if (!IS_SUPABASE_CONFIGURED) return NextResponse.next();

  const response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // AUDIT C6: enforce SameSite=Lax on auth cookies for CSRF protection.
          // @supabase/ssr defaults to SameSite=Lax, but we set it explicitly
          // here so it can't be accidentally weakened by upstream changes.
          response.cookies.set(name, value, {
            ...options,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected =
    request.nextUrl.pathname === '/dashboard' ||
    request.nextUrl.pathname === '/history' ||
    request.nextUrl.pathname === '/analytics' ||
    request.nextUrl.pathname === '/settings';

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect already-signed-in users away from the auth pages.
  const isAuthPage =
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password';
  if (isAuthPage && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
