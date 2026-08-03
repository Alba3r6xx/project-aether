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

  const pathname = request.nextUrl.pathname;

  // Only run the Supabase session check for routes that actually need it.
  // Calling supabase.auth.getUser() on every request adds 2-6 seconds on
  // Vercel serverless (network round-trip to Supabase auth API). By limiting
  // it to protected + auth pages, the homepage and static assets load instantly.
  const isProtected =
    pathname === '/dashboard' ||
    pathname === '/history' ||
    pathname === '/analytics' ||
    pathname === '/settings';

  const isAuthPage =
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/forgot-password';

  if (!isProtected && !isAuthPage) {
    return NextResponse.next();
  }

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

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirect already-signed-in users away from the auth pages.
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
