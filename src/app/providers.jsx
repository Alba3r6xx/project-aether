'use client';

import { createContext, useContext } from 'react';
import { AuthProvider } from '../context/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary/ErrorBoundary';
import NetworkBanner from '../components/NetworkBanner/NetworkBanner';
import ServiceWorkerRegistration from '../components/ServiceWorkerRegistration/ServiceWorkerRegistration';

/**
 * Client-side Providers wrapper mounted from the root Server Component
 * layout (app/layout.jsx). Keeping the providers in a separate 'use client'
 * file lets the layout itself remain a Server Component while still
 * wrapping every route in the AuthProvider.
 *
 * Also wraps the app in a global ErrorBoundary (catches render errors,
 * closes G12) and a NetworkBanner (shows an offline indicator when the
 * browser loses connectivity).
 */
export function Providers({ children }) {
  return (
    <ErrorBoundary>
      <NetworkBanner />
      <ServiceWorkerRegistration />
      <AuthProvider>{children}</AuthProvider>
    </ErrorBoundary>
  );
}
