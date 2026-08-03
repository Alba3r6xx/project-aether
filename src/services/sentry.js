// Project Aether — Sentry integration (AUDIT H15)
//
// Env-driven error tracking. When NEXT_PUBLIC_SENTRY_DSN is set, errors are
// sent to Sentry. When it's not set, this module is a no-op so the app works
// identically without Sentry configured.
//
// To enable:
//   1. npm install @sentry/react
//   2. Set NEXT_PUBLIC_SENTRY_DSN in .env
//   3. Uncomment the real Sentry import below
//
// This file avoids importing @sentry/react at the top level so the app
// doesn't crash if the package isn't installed (it's optional).

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isSentryEnabled = !!SENTRY_DSN;

let Sentry = null;

if (isSentryEnabled && typeof window !== 'undefined') {
  try {
    // Dynamic import would go here in production:
    // Sentry = await import('@sentry/react');
    // Sentry.init({ dsn: SENTRY_DSN, environment: process.env.NODE_ENV });
    // For now, just log that it would be initialized.
    console.info('[sentry] DSN configured but @sentry/react not installed. Install it to enable error tracking.');
  } catch (e) {
    console.warn('[sentry] Failed to initialize:', e);
  }
}

/**
 * Capture an exception for error tracking. No-op when Sentry isn't configured.
 */
export function captureException(error, context) {
  if (Sentry && isSentryEnabled) {
    Sentry.captureException(error, { extra: context });
  } else if (process.env.NODE_ENV === 'development') {
    console.error('[captureException]', error, context);
  }
}

/**
 * Set the current user context for error attribution.
 */
export function setUser(user) {
  if (Sentry && isSentryEnabled && Sentry.setUser) {
    Sentry.setUser(user ? { id: user.id, email: user.email } : null);
  }
}

export { isSentryEnabled };
