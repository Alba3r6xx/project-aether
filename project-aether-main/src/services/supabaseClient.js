'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_SUPABASE_CONFIGURED } from './config';

/**
 * Single shared browser-side Supabase client for the whole app - auth,
 * database reads/writes, and realtime subscriptions all go through this
 * instance.
 *
 * Uses @supabase/ssr's createBrowserClient so auth tokens are persisted in
 * cookies that the Next.js middleware (src/middleware.js) can read on every
 * navigation, keeping Server Components and the client in sync.
 *
 * `supabase` is `null` until NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are set, so the app can still run in
 * mock/demo mode before the Supabase project exists. Every function that
 * uses it (authService.js, historyService.js) checks IS_SUPABASE_CONFIGURED
 * first and falls back to mock data/local-only behaviour otherwise.
 */
export const supabase = IS_SUPABASE_CONFIGURED
  ? createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export { IS_SUPABASE_CONFIGURED };
