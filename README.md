# Project Aether — Next.js Edition

A Next.js 16 (App Router) port of the Project Aether air-quality & comfort
dashboard. Same UI, same HiveMQ + Supabase backend contract, but rebuilt on
Next.js with **hybrid rendering**: the public Landing page and the
History/Analytics initial data are server-rendered, while the live MQTT
dashboard stays client-side.

This folder (`Project-Aether-next/`) lives alongside the original Vite build
(`Project-Aether-main/`), which remains the reference implementation.

## Stack
- Next.js 16.2.12 (App Router, Turbopack)
- React 19
- Tailwind CSS v4 (via `@tailwindcss/postcss`)
- Recharts, Framer Motion, Lucide React
- `@supabase/ssr` 0.12.3 + `@supabase/supabase-js` (auth + Postgres, with
  cookie-based sessions shared between Server Components, middleware, and
  the browser)
- Supabase Edge Functions (Deno) for MQTT ingestion, alerting, and reports
- No `mqtt.js` in the browser — MQTT is handled server-side by the
  `ingest-mqtt` Edge Function (Phase B1)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Project structure

```
src/
  app/
    layout.jsx            Root Server Component - fonts, metadata, <Providers>
    providers.jsx         'use client' - mounts AuthProvider
    globals.css           Tailwind v4 theme (navy palette, fonts, focus ring)
    page.jsx              Landing (Server Component composing client sections)
    not-found.jsx         404
    login/page.jsx        Client - sign in form
    signup/page.jsx       Client - sign up form
    forgot-password/page.jsx
    dashboard/
      page.jsx            Server Component - SSR-fetches alerts + latest row
      DashboardClient.jsx 'use client' - live data via Supabase Realtime
    history/
      page.jsx            Server Component - SSR-fetches daily history
      HistoryClient.jsx   'use client' - CSV export + ChartCard + table
    analytics/page.jsx    Server Component - composes ChartCard with SSR series
    settings/page.jsx     'use client' - useAuth + toggles + node claiming
    api/health/route.js   Health check endpoint
  middleware.js           Refreshes Supabase session + guards protected routes
  components/             UI components (client components marked 'use client')
  context/AuthContext.jsx 'use client' - Supabase auth state
  hooks/useSensorNodes.js 'use client' - Supabase Realtime live data
  services/
    config.js             env-driven config (NEXT_PUBLIC_* vars)
    supabaseClient.js     'use client' - browser Supabase client (@supabase/ssr)
    supabaseServer.js     server Supabase client (cookies())
    authService.js        'use client' - auth wrapper
    historyService.js     'use client' - history/alerts/latest reads + Realtime
    historyServiceServer.js server-only fetchers for SSR initial data
  utils/                  cn + format helpers + password strength
supabase/
  schema.sql              Full schema (reference)
  migrations/             0001–0006 migrations (run via supabase db push)
  functions/              Edge Functions (Deno): ingest-mqtt, evaluate-alerts,
                          claim-node, weekly-summary, latest-readings
```

## Env vars

Copy `.env.example` to `.env`. Client-side vars use the `NEXT_PUBLIC_`
prefix; server-only secrets (MQTT credentials, Supabase service_role key)
do NOT use the prefix and are only used by Edge Functions.

### Client-side (browser-visible)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Server-only (Edge Function secrets — set via Supabase Dashboard)
```
MQTT_BROKER_URL=         # e.g. mqtts://broker.hivemq.com:8883
MQTT_USERNAME=           # optional
MQTT_PASSWORD=           # optional
MQTT_TOPIC=aether/sensors
SUPABASE_URL=            # same as NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=
```

To set Edge Function secrets:
1. Go to Supabase Dashboard > Edge Functions > [function-name] > Secrets
2. Add each key-value pair

Restart `npm run dev` after editing `.env` (Next.js reads env on startup).

## Hybrid rendering notes

- **Landing** (`/`): Server Component shell; the marketing sections are
  client components that hydrate framer-motion animations. Good for SEO.
- **Dashboard** (`/dashboard`): Server Component pre-fetches alerts + the
  latest reading row, hands them to a client component that owns the live
  MQTT subscription. First paint isn't empty; live updates stream in after
  hydration.
- **History** (`/history`): Server Component fetches the daily history
  table; the client component owns the CSV export (browser Blob API).
- **Analytics** (`/analytics`): Server Component composes ChartCard with
  the mock series; Recharts hydrates on the client.
- **Auth pages**: client components (forms + `useRouter` redirects).
- **Middleware**: refreshes the Supabase session cookie on every request
  and redirects unauthenticated users away from protected routes when
  Supabase is configured. When Supabase isn't configured, it's a no-op so
  the demo/mock-mode dashboard stays fully open.

## No mock data

This build does **not** ship mock sensor data. Every reading, alert, chart
series, and node list comes from Supabase (`sensor_readings` + `alerts`
tables) or the live HiveMQ MQTT feed. With no `.env` configured:

- The middleware is a no-op, so every route stays open (you can see the UI).
- Every data fetch returns an empty array / `null` and logs a warning, so
  the dashboard, history table, analytics charts, and alerts panel render
  honest **empty states** ("No readings recorded yet", blank charts, etc.)
  instead of fabricated values.
- The connection badge shows **Offline** (no MQTT/WebSocket configured).

To see real data, set the `NEXT_PUBLIC_SUPABASE_*` and `NEXT_PUBLIC_MQTT_*`
vars in `.env`, run `supabase/schema.sql` in your Supabase project, and
restart `npm run dev`.

The static config that *isn't* sensor data — comfort-level definitions,
metric metadata, the comfort-index formula, and the Landing page's
testimonials — lives in `src/data/constants.js` and `src/data/content.js`.
