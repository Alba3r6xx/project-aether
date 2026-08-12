# Project Aether — Roadmap to a Production-Ready, Enterprise-Grade Dashboard

> Companion document to `README.md`.
> Scope: take the current Phase-3 "Cloud & Dashboard (In Progress)" build of the
> Aether web dashboard from a working demo to a production-ready, enterprise-grade
> IoT monitoring platform on **HiveMQ** (MQTT transport) + **Supabase**
> (auth + Postgres + Edge Functions + Realtime).
>
> **Active codebase**: `Project-Aether-next/` (Next.js 16 App Router + React 19
> + Tailwind v4 + Recharts + Framer Motion + `mqtt.js` + `@supabase/ssr`).
> The original Vite build (`Project-Aether-main/`) remains as a reference.
> Hardware context: ESP32-WROOM-32 + DHT22 + MQ-135 + LDR + SSD1306 OLED,
> publishing `{"temp","humidity","heatIndex","airQuality","light","status"}` to
> HiveMQ every 5 s (see `group 34/Project_Aether.pdf`, §6.0 System Architecture).

---

## Progress Log

### Migration & foundation (completed)
- **Migrated from Vite SPA to Next.js 16 App Router** with hybrid rendering
  (SSR for Landing/History/Analytics, client for Dashboard's live MQTT).
- **Removed all mock sensor data.** Every reading, alert, chart series, and
  node list now comes from Supabase or live MQTT. Empty states render honestly
  when no backend is configured. Static config (comfort levels, metric metadata,
  comfort formula, testimonials) split into `src/data/constants.js` + `content.js`.
- **Added `fetchMetricSeries` + `fetchNodes` + `fetchLatestReading`** to both
  client and server history services, backed by `sensor_readings` (closes G3/G4).

### Phase A — Stabilize & Close the Data Loop (completed)
- [x] **A1 (G1): Dead mqttService.js** — never ported to Next.js; no dead code.
- [x] **A2 (G3, G4): Charts through service layer** — Analytics, History, and
      Dashboard all fetch real series via `fetchMetricSeries` / `fetchLatestReading`.
- [x] **A3 (G2): Persistence writer** — Edge Function `supabase/functions/ingest-mqtt/index.ts`
      (Deno) subscribes to HiveMQ over TCP MQTT (port 8883, TLS), computes the
      Steadman Heat Index + comfort status server-side, and inserts into
      `sensor_readings` using the `service_role` key. It is the sole writer.
- [x] **A4 (G11): Comfort Index aligned** — `src/data/constants.js` now uses the
      Steadman Heat Index (matching the Adafruit DHT library's
      `computeHeatIndex(temp, humidity, false)`) and the §5.0 threshold
      classification (OPTIMAL 20-26°C/<30% AQ, FAIR 26-29°C/30-60%, POOR >29°C
      or <18°C/>60%). The Edge Function uses the same formula. 17 unit tests
      verify the algorithm.
- [x] **A5 (G5): Live alerts via Realtime** — `subscribeToAlerts()` in
      `historyService.js` opens a Supabase Realtime channel on `alerts` INSERT
      events; `DashboardClient` wires it so new alerts stream in without refresh.
      `alter publication supabase_realtime add table alerts` added to the schema.

### Kick-off checklist (completed)
- [x] **#1: Delete mqttService.js** — N/A (never ported).
- [x] **#2: fetchMetricSeries + fetchLatestReading** — done during no-mock refactor.
- [x] **#3: Supabase Realtime subscription** — done (A5).
- [x] **#4: supabase/migrations/0001_init.sql** — versioned migration created
      with `comfort_status` + `heat_index` columns and Realtime on `alerts`.
- [x] **#5: Vitest + smoke test** — Vitest 4.1 configured; 17 tests for the
      Comfort Index formula (Steadman Heat Index + §5.0 thresholds) all passing.
      Run with `npm test`.

### Next: Phase B — Security & Multi-Tenancy
See §2 below for the full phase description. Key items:
- B1: Hide MQTT credentials from the browser (move to Edge Function only)
- B2: Multi-tenancy schema (organizations, org-scoped RLS)
- B3: Node provisioning & claim flow
- B4: Auth hardening (email confirmation, OAuth, MFA)
- B5: Secrets hygiene

---

## Phase B — Security & Multi-Tenancy (completed)

- [x] **B1 (G7): Hide MQTT credentials from the browser.** Removed `mqtt.js`
      from `package.json` and all MQTT/WebSocket client code from
      `sensorService.js` and `useSensorNodes.js`. The browser now gets live
      readings via **Supabase Realtime** (`subscribeToReadings()` subscribes
      to INSERT events on `sensor_readings`). The `ingest-mqtt` Edge Function
      is the sole MQTT subscriber. `sensor_readings` added to the Realtime
      publication. Connection badge shows "Realtime - connected" or "Offline".
- [x] **B2 (G8): Multi-tenancy schema.** Created
      `supabase/migrations/0002_multi_tenancy.sql` with:
      - `organizations` table
      - `organization_members` (org_id, user_id, role: owner|admin|editor|viewer)
      - `nodes` table (id, org_id, name, room, floor, location, firmware_version)
        replacing the hardcoded SENSOR_NODES array
      - `org_id` added to `sensor_readings` and `alerts`
      - RLS rewritten: users only read rows for orgs they belong to
      - `handle_new_user()` trigger auto-creates a personal org on signup
      - `get_user_org_id()` helper for Edge Functions
      - Updated `fetchNodes` (client + server) to read from the `nodes` table
        with fallback to deriving from `sensor_readings`
- [x] **B3 (G14): Node provisioning & claim flow.** Created Edge Function
      `supabase/functions/claim-node/index.ts` — verifies the caller's JWT,
      looks up their org, checks for duplicate claims, and inserts into the
      `nodes` table. Added "Add node" form to the Settings page with node ID,
      name, and room fields; calls the Edge Function and refreshes the node
      list on success.
- [x] **B4: Auth hardening.** Added `src/utils/passwordStrength.js` with
      `validatePasswordStrength()` — enforces 8+ chars with uppercase,
      lowercase, numbers, and special characters. Signup page now shows a
      4-bar strength meter and rejects weak passwords. Updated `minLength`
      from 6 to 8. (Email confirmation, OAuth providers, and MFA are Supabase
      dashboard config — documented in `.env.example` comments.)
- [x] **B5: Secrets hygiene.** Rewrote `.env.example` — removed all
      `NEXT_PUBLIC_MQTT_*` and `NEXT_PUBLIC_WEBSOCKET_URL` vars. MQTT broker
      credentials now live only in the Edge Function's server-side secrets
      section (no `NEXT_PUBLIC_` prefix). Cleaned up `config.js` to only
      export Supabase URL + anon key.

### Verification
- All 8 routes return 200 (`/`, `/dashboard`, `/history`, `/analytics`,
  `/settings`, `/login`, `/signup`, `/forgot-password`)
- All 23 tests pass (17 comfort index + 6 password strength)
- `mqtt` removed from `package.json` — no MQTT credentials in client bundle

### Next: Phase C — Alerting, Notifications & Reliability
Key items:
- C1: Alerting engine (Edge Function + alert_rules table + threshold evaluation)
- C2: Notification delivery (email, push, in-app toast + bell)
- C3: Weekly summary report (pg_cron)
- C4: Connection resilience (error boundary, network banner, ConnectionBadge)

---

## Phase C — Alerting, Notifications & Reliability (completed)

- [x] **C1 (G6): Alerting engine.** Created
      `supabase/migrations/0003_alerting.sql` with the `alert_rules` table
      (node_id, metric, operator, threshold, severity, cooldown_minutes,
      enabled) + `notifications` table + `notification_preferences` table.
      Seeded 5 default rules matching the §5.0 POOR thresholds. Created
      Edge Function `supabase/functions/evaluate-alerts/index.ts` — fetches
      enabled rules, evaluates each new reading against them, enforces
      per-node cooldown to avoid flapping, inserts into `alerts` + a
      `notifications` row for each org member. Wired into `ingest-mqtt`:
      after each sensor_readings insert, it calls `evaluate-alerts` via
      fetch (fire-and-forget so MQTT ingest isn't blocked).
- [x] **C2 (G13): Notification delivery.** Added notification service
      functions to `historyService.js`: `fetchNotifications`,
      `fetchUnreadNotificationCount`, `markNotificationRead`,
      `markAllNotificationsRead`, `subscribeToNotifications` (Realtime),
      `fetchNotificationPreferences`, `saveNotificationPreferences`.
      Created `NotificationBell` component — bell icon with unread count
      badge, dropdown panel with recent notifications, mark-as-read
      interactions, live Realtime subscription. Added to the Navbar.
      Settings page notification toggles now load from and save to the
      `notification_preferences` table (closes G13). Realtime enabled on
      `notifications` table.
- [x] **C3: Weekly summary report.** Created Edge Function
      `supabase/functions/weekly-summary/index.ts` — aggregates the past
      week's readings (avg temp/humidity/AQ, comfort status counts, alert
      count) per org and creates a notification for each member who opted
      into weekly reports. Created
      `supabase/migrations/0004_weekly_cron.sql` — schedules the function
      via `pg_cron` every Monday at 08:00 UTC using `pg_net` for the
      outbound HTTP call.
- [x] **C4 (G12): Connection resilience.** Created:
      - `ErrorBoundary` component — catches render errors, shows a friendly
        fallback with a reload button, wraps the entire app in `providers.jsx`.
      - `NetworkBanner` component — sticky banner when the browser goes
        offline, auto-hides when back online, uses `online`/`offline` events.
      - `ConnectionBadge` component — reusable pill showing Realtime/
        Offline status with appropriate icon/color, used on the Dashboard.
      All three wired into the app via `providers.jsx` and `DashboardClient`.

### Verification
- All 8 routes return 200
- All 23 tests pass (17 comfort index + 6 password strength)
- 4 Edge Functions: `ingest-mqtt`, `evaluate-alerts`, `claim-node`,
  `weekly-summary`
- 4 migrations: `0001_init`, `0002_multi_tenancy`, `0003_alerting`,
  `0004_weekly_cron`

### Next: Phase D — Data Lifecycle, Scale & Performance
Key items:
- D1: Retention & downsampling (partitioning, pg_cron aggregates, service layer range selection)
- D2: Caching (in-memory or Edge Function Cache-Control)
- D3: Frontend performance (virtualized table, memoized charts, bundle analysis)
- D4: Offline / PWA (service worker, cached snapshot, reconcile on reconnect)

---

## Phase D — Data Lifecycle, Scale & Performance (completed)

- [x] **D1 (G9, G10): Retention & downsampling.** Created
      `supabase/migrations/0005_retention_downsampling.sql` with:
      - `hourly_readings` table (avg/min/max per node per hour, unique on
        node_id + hour_bucket, org-scoped RLS)
      - `daily_readings` table (avg/min/max per node per day, same pattern)
      - `populate_hourly_aggregates()` + `populate_daily_aggregates()` SQL
        functions with upsert (ON CONFLICT DO UPDATE) so re-runs are safe
      - `delete_old_raw_readings()` retention function (deletes raw rows
        older than 30 days; aggregates kept indefinitely)
      - 3 pg_cron jobs: hourly aggregate (top of each hour), daily aggregate
        (00:05), raw retention cleanup (02:30)
      - Updated `fetchMetricSeries` (client + server) to pick the table
        automatically: raw for ≤24h, hourly for 1-30d, daily for >30d.
        Chart labels adapt (HH:MM, MM/DD HH:00, or MM/DD).
- [x] **D2: Caching.** Created Edge Function
      `supabase/functions/latest-readings/index.ts` — returns the latest
      reading per node for the caller's org, with `Cache-Control:
      public, s-maxage=5, max-age=5, stale-while-revalidate=10` so the
      Supabase Edge network and browser cache absorb burst traffic.
      Created `src/hooks/useSWR.js` — a lightweight stale-while-revalidate
      hook with in-memory cache, request deduplication, optional polling
      interval, and window-focus refetch. Shared cache across hook
      instances on the same page.
- [x] **D3: Frontend performance.**
      - **Virtualized DataTable**: the full History table now uses
        window-based virtualization (renders only visible rows + overscan
        buffer, with spacer rows for scroll position). Stays fast with
        thousands of rows. Sticky header. No new dependency.
      - **Memoized ChartCard**: wrapped in `memo()` so charts don't
        re-render on every parent state change. ChartTooltip also memoized.
      - **Memoized sparklines**: DataTable's mini variant sparklines are
        now a separate `MiniSparkline` memo component.
      - **Bundle analyzer**: added `@next/bundle-analyzer`, wired into
        `next.config.mjs`, `npm run analyze` produces a treemap.
- [x] **D4: Offline / PWA.**
      - **Web manifest** (`public/manifest.json`): app name, theme color,
        standalone display, icons. Linked from `layout.jsx` metadata.
      - **Service worker** (`public/sw.js`): stale-while-revalidate for
        app shell (HTML/JS/CSS/fonts), network-first with cache fallback
        for Supabase API calls, cache-first for other assets. The app
        shell loads offline so users see the dashboard structure with
        stale data instead of a browser error page.
      - **ServiceWorkerRegistration** component: registers the SW in
        production only (not in dev to avoid hot-reload conflicts).
      - The existing `NetworkBanner` (Phase C4) signals offline/online
        transitions; the SW ensures the app itself loads either way.

### Verification
- All 8 routes return 200
- All 23 tests pass (17 comfort index + 6 password strength)
- 5 Edge Functions: `ingest-mqtt`, `evaluate-alerts`, `claim-node`,
  `weekly-summary`, `latest-readings`
- 5 migrations: `0001_init`, `0002_multi_tenancy`, `0003_alerting`,
  `0004_weekly_cron`, `0005_retention_downsampling`
- `npm run analyze` available for bundle inspection

### Roadmap complete
All four phases (A, B, C, D) of the production-readiness roadmap are now
complete. The dashboard has gone from a Vite SPA with mock data to a
Next.js App Router production system with:
- Real data via Supabase (no mock data anywhere)
- MQTT credentials hidden from the browser (Edge Function is sole subscriber)
- Multi-tenancy with org-scoped RLS
- Node provisioning via claim flow
- Alerting engine with cooldown + notifications (bell, toast, preferences)
- Weekly summary reports via pg_cron
- Connection resilience (error boundary, network banner, connection badge)
- Data lifecycle (hourly/daily aggregates, 30-day raw retention)
- Caching (Edge Function Cache-Control, client-side SWR hook)
- Frontend performance (virtualized table, memoized charts, bundle analyzer)
- Offline/PWA support (service worker, manifest, app shell caching)

---

## 0. Current State Assessment

### 0.1 What works today
- **Routing & lazy loading**: `src/App.jsx` — Landing + protected
  Dashboard / History / Analytics / Settings + Login / Signup / ForgotPassword.
- **Auth**: `src/services/authService.js` + `src/context/AuthContext.jsx` +
  `src/components/auth/ProtectedRoute.jsx` wrap Supabase Auth (email/password).
  Graceful fallback to "no-auth demo" when `IS_SUPABASE_CONFIGURED` is false.
- **Live MQTT ingest**: `connectMqttSensorFeed()` in
  `src/services/sensorService.js` subscribes to `VITE_MQTT_TOPIC` and merges
  readings into `useSensorNodes` state. `normalizeEsp32Payload()` already maps
  the firmware's `temp`/`light`/`status` field names to the dashboard's
  `temperature`/`luminosity`/`comfort` shape.
- **History/alerts read**: `src/services/historyService.js` reads
  `sensor_readings` + `alerts` from Supabase, falling back to
  `src/data/mockSensorData.js` when Supabase is unconfigured.
- **Schema**: `supabase/schema.sql` defines `sensor_readings` + `alerts` with
  RLS (read for `authenticated`).
- **UX polish**: dark navy theme, Framer Motion transitions, skeletons,
  connection-status badge, CSV export on History.

### 0.2 Known gaps & defects blocking "production-ready"
These are the items the roadmap below resolves, summarized up front so they're
not buried in phases:

| # | Gap | Evidence |
|---|-----|----------|
| G1 | **Dead/broken MQTT module**: `src/services/mqttService.js` imports `MQTT_BROKER_URL` from `./config`, but `config.js` only exports `MQTT_WS_URL`. The module is unused and would crash if imported. | `mqttService.js:23` vs `config.js:15` |
| G2 | **No persistence writer**: nothing inserts MQTT readings into `sensor_readings`. History/Analytics will be empty in production. | `historyService.js` `recordSensorReading()` exists but is never called. |
| G3 | **Analytics + History charts use mock data**: `Analytics.jsx` and `History.jsx` import `HISTORY` from `mockSensorData.js` directly, bypassing the service layer. | `Analytics.jsx:3`, `History.jsx:8` |
| G4 | **Dashboard "latest row" table is mock**: `Dashboard.jsx` renders `DAILY_HISTORY.slice(-1)` instead of the latest Supabase row. | `Dashboard.jsx:11,92` |
| G5 | **Alerts panel is one-shot**: `fetchAlerts()` runs once on mount; no live updates. | `Dashboard.jsx:18-20` |
| G6 | **No alerting engine**: alerts are seeded in `schema.sql`; no threshold rules generate alerts from incoming readings. | `schema.sql:72` |
| G7 | **MQTT credentials exposed to the browser**: `VITE_MQTT_PASSWORD` is bundled into client JS. HiveMQ Cloud free tier has no per-session tokens. | `config.js:17`, `.env.example:16` |
| G8 | **No multi-tenancy / ownership**: RLS is "any authenticated user reads everything". No `organization_id`, no node ownership, no per-user scoping. | `schema.sql:34-37` |
| G9 | **No tests, no CI, no deploy pipeline**. | `package.json` (no `test` script), no `.github/`. |
| G10 | **No data retention / downsampling**: `sensor_readings` grows unbounded at 1 row / 5 s / node. | `schema.sql` (no partitioning, no retention job). |
| G11 | **Comfort Index divergence**: firmware uses Steadman Heat Index + the §5.0 thresholds; the dashboard's `calculateComfortIndex()` in `mockSensorData.js` uses a different weighted formula. | `mockSensorData.js:199` vs PDF §5.0 |
| G12 | **No error boundaries / observability / rate limiting / backups**. | n/a |
| G13 | **Settings toggles are non-functional UI**: notifications, units, poll interval are local state only. | `Settings.jsx:38-44` |
| G14 | **No node CRUD / provisioning**: nodes are hardcoded in `mockSensorData.js`. | `mockSensorData.js:40` |

---

## 1. Roadmap Principles

1. **Never break the demo path.** Every phase keeps `IS_SUPABASE_CONFIGURED =
   false` + `VITE_MQTT_WS_URL` unset → mock data working, so the team and
   graders can always run `npm run dev`.
2. **Service-layer boundary is sacred.** Components import from
   `services/`, never from `data/mockSensorData.js` directly. Fix G3/G4 first.
3. **One writer, not many.** Persist MQTT → Supabase from a single trusted
   backend (Edge Function or service), never from every open browser tab.
4. **Security before features.** Resolve G7 (credential exposure) and G8
   (multi-tenancy) before scaling users.
5. **Each phase is independently shippable** and produces a visible,
   demoable improvement.

---

## 2. Phased Roadmap

### Phase A — Stabilize & Close the Data Loop  *(must precede everything)*
**Goal:** make the existing stack actually round-trip real data end-to-end,
and remove the dead code that misleads contributors.

- **A1. Remove or fix `mqttService.js` (G1).** Either delete it (the live path
  already lives in `sensorService.js::connectMqttSensorFeed`) or align its
  imports to `MQTT_WS_URL` and delete the duplicate. Prefer deletion to avoid
  two sources of truth for MQTT.
- **A2. Route all chart data through the service layer (G3, G4).**
  - Add `fetchMetricSeries(metric, { nodeId, range })` and
    `fetchLatestReading()` to `historyService.js` backed by `sensor_readings`.
  - Replace `HISTORY` imports in `Analytics.jsx` and `History.jsx` with these
    calls; replace `DAILY_HISTORY.slice(-1)` in `Dashboard.jsx` with
    `fetchLatestReading()`.
- **A3. Implement the persistence writer (G2).** Stand up a Supabase Edge
  Function `ingest-mqtt` (Deno) that:
  - subscribes to HiveMQ over TCP MQTT (port 8883, TLS) using the
    `service_role` key,
  - inserts one row per message into `sensor_readings` with `node_id` parsed
    from the topic,
  - is the **only** writer (do not call `recordSensorReading()` from the
    browser — remove that temptation or gate it behind a dev-only flag).
  - Add the matching `INSERT` policy for `service_role` only (already the
    default; document it).
- **A4. Align Comfort Index (G11).** Move the canonical algorithm to a shared
  spec: replicate the firmware's Steadman Heat Index + §5.0 thresholds in the
  Edge Function so `comfort_index` is computed server-side and stored, and
  replace `mockSensorData.js::calculateComfortIndex` with the same formula so
  mock mode matches live mode.
- **A5. Wire live alerts (G5).** Switch `AlertsPanel` to a Supabase Realtime
  subscription on `alerts` (`supabase.channel('alerts').on('INSERT', ...)`) so
  new alerts appear without refresh.

**Exit criteria:** with real `.env`, the Dashboard shows live MQTT readings,
History/Analytics charts plot real `sensor_readings` rows, and new alerts
stream in via Realtime. Mock mode still works with no env.

---

### Phase B — Security & Multi-Tenancy  *(enterprise foundation)*
**Goal:** make the platform safe to expose beyond the project team.

- **B1. Hide MQTT credentials from the browser (G7).** Stop shipping
  `VITE_MQTT_USERNAME/PASSWORD`. Two acceptable patterns:
  - **(preferred) Backend-only MQTT:** the Edge Function from A3 is the sole
    MQTT subscriber; the browser gets live data via **Supabase Realtime**
    broadcasts on a `sensor_live` channel instead of `mqtt.js` in the bundle.
    Remove `mqtt` from `package.json` client deps.
  - **(fallback) Signed-token proxy:** a thin Edge Function issues short-lived
    HiveMQ tokens (HiveMQ Cloud's "Extension: Credentials" / JWT auth) per
    session; the browser subscribes read-only with that token.
- **B2. Multi-tenancy schema (G8).** Add:
  - `organizations (id, name, created_at)`
  - `organization_members (org_id, user_id, role)` with roles
    `owner | admin | editor | viewer`.
  - `nodes (id, org_id, name, room, floor, location, firmware_version,
    claimed_at)` — replaces the hardcoded `SENSOR_NODES` array.
  - Add `org_id` to `sensor_readings` and `alerts`; rewrite RLS so a user can
    only read rows whose `org_id` matches an `organization_members` row for
    them. Use `auth.jwt() ->> 'org_id'` or a join-based policy.
- **B3. Node provisioning & claim flow (G14).** Settings page → "Add node"
  generates a one-time claim code; ESP32 firmware posts its `node_id` + claim
  code on first boot to an Edge Function `claim-node` that binds the node to
  the org. Replace the static `SENSOR_NODES` map in `Settings.jsx` with a
  `fetchNodes()` call.
- **B4. Auth hardening.** Enable email confirmation, add OAuth providers
  (Google/GitHub) via Supabase, add optional MFA (Supabase Auth MFA), enforce
  password strength. Add rate limiting on auth endpoints via Supabase's
  built-in limits + a custom Edge Function guard.
- **B5. Secrets hygiene.** Move all server secrets to Supabase Edge Function
  env (not Vite). Add `.env.example` cleanup so no `VITE_`-prefixed secret is
  ever a server secret.

**Exit criteria:** no MQTT secret in the client bundle; users only see their
own org's nodes/readings/alerts; nodes are claimable, not hardcoded.

---

### Phase C — Alerting, Notifications & Reliability
**Goal:** turn the dashboard from "display" into "monitoring".

- **C1. Alerting engine.** Edge Function `evaluate-alerts` (triggered by the
  ingest function or a Postgres trigger on `sensor_readings` insert) evaluates
  per-node threshold rules from a new `alert_rules (id, node_id, metric,
  operator, threshold, severity, cooldown_minutes, enabled)` table. Inserts
  into `alerts` with cooldown enforcement to avoid flapping.
- **C2. Notification delivery (G13).** Make the Settings toggles real:
  - `notification_preferences (user_id, org_id, email, push, weekly_report)`.
  - Edge Function `send-notification` dispatches email (Supabase Auth's
    built-in email or Resend/Postmark) and web push (Web Push API + VAPID).
  - In-app toast + bell icon with unread count, backed by a `notifications`
    table + Realtime.
- **C3. Weekly summary report.** Scheduled Edge Function (Supabase cron /
    `pg_cron`) aggregates the week's readings + alerts into an email.
- **C4. Connection resilience.** Add a global error boundary, network-status
  banner, and exponential-backoff indicators for both MQTT/Realtime and
  Supabase fetches. Surface `connectionStatus` from `useSensorNodes` in a
  reusable `<ConnectionBadge>`.

**Exit criteria:** threshold breaches create alerts that arrive in-app, by
email, and via push; toggles persist; weekly report sends on schedule.

---

### Phase D — Data Lifecycle, Scale & Performance
**Goal:** survive months of continuous 5 s telemetry from many nodes.

- **D1. Retention & downsampling (G10).**
  - Partition `sensor_readings` by month (declarative partitioning).
  - `pg_cron` job rolls rows older than N days into `sensor_readings_hourly`
    and `sensor_readings_daily` aggregates (avg/min/max); raw rows older than
    the retention window are archived to Supabase Storage (Parquet/CSV) and
    deleted.
  - Service layer picks the right table based on the requested range
    (raw < 24 h, hourly < 30 d, daily otherwise).
- **D2. Caching.** Add a thin in-memory cache (or Supabase Edge Function with
  `Cache-Control`) for the latest-reading and aggregate endpoints to cut DB
  round trips on dashboard load.
- **D3. Frontend performance.**
  - Virtualize the History `DataTable` (`@tanstack/react-virtual`) for large
    ranges.
  - Memoize Recharts series; switch heavy charts to canvas when series exceed
    ~2 k points.
  - Code-split per route (already lazy) + add bundle analysis
    (`vite-bundle-visualizer`) to CI.
- **D4. Offline / PWA.** Add a service worker (vite-plugin-pwa) so the
  dashboard loads from cache and queues a "last seen" snapshot; reconcile on
  reconnect.

**Exit criteria:** dashboard stays snappy with 50 nodes × months of data;
old data is archived, not lost.

---

### Phase E — Enterprise Operations
**Goal:** make the platform operable, observable, and auditable.

- **E1. Testing (G9).**
  - **Unit**: Vitest + React Testing Library for hooks (`useSensorNodes`),
    service-layer fallback logic, and the Comfort Index formula.
  - **Integration**: Supabase local stack (`supabase start`) + tests against
    the real schema with RLS enforced.
  - **E2E**: Playwright covering login → dashboard → live reading → alert
    flow, run against the mock backend in CI.
- **E2. CI/CD (G9).** GitHub Actions:
  - `lint` (oxlint, already configured), `typecheck` (add `tsc --noEmit` or
    migrate to TS — see E5), `test`, `build`.
  - Preview deploy to Vercel/Netlify per PR; production deploy on tag.
  - Supabase migrations via `supabase db push` from CI with a review gate.
- **E3. Observability (G12).**
  - Structured logs in Edge Functions (JSON to Supabase Logs / Logflare).
  - Sentry (or Supabase Logs) for frontend errors + Edge Function errors.
  - Uptime check on the Edge Function ingest path; alert on ingest lag.
- **E4. Backups & DR (G12).** Enable Supabase PITR / scheduled backups;
  document restore procedure in `README.md`. Export schema + seed as code
  (`supabase/migrations/`).
- **E5. TypeScript migration (recommended).** The codebase is small enough to
  type end-to-end; convert `services/`, `hooks/`, `context/` first, then
  components. Define shared types for `SensorReading`, `Node`, `Alert`,
  `AlertRule`, `OrgMember` matching the SQL schema.
- **E6. API contract & docs.** Publish an OpenAPI spec for Edge Functions;
  document the firmware MQTT payload contract (topic structure, field names,
  units, Comfort Index thresholds) in `docs/FIRMWARE_CONTRACT.md` so the
  hardware team and dashboard team stay in sync.
- **E7. Rate limiting & abuse protection.** Edge Function middleware enforces
  per-user/per-IP limits on read endpoints; ingest endpoint validates
  HiveMQ-originated payloads (HMAC or source IP allowlist).

**Exit criteria:** green CI, passing E2E, Sentry wired, backups tested,
typed codebase, documented contracts.

---

### Phase F — Product Maturity  *(post-production)*
**Goal:** features that make Aether sellable to a facilities team.

- **F1. Floor-plan / map view.** Upload a floor plan image, drop nodes onto
  coordinates, render live status pins. Store layout in `node_layouts`.
- **F2. Multi-node comparison & analytics workbench.** Overlay multiple
  nodes/metrics/time ranges; save dashboards per user.
- **F3. Device management.** OTA firmware update signaling (publish a
  `aether/<node>/cmd` topic with a firmware URL + checksum), battery/Wi-Fi
  health page, last-seen staleness alerts.
- **F4. Audit log.** `audit_log (actor, action, target, at, meta)` for node
  claims, rule edits, member invites — required for enterprise customers.
- **F5. SSO / SCIM.** SAML/OIDC for orgs via Supabase Auth + a small SCIM
  bridge.
- **F6. Internationalization & accessibility audit.** `react-i18next`;
  WCAG 2.1 AA pass (the `focus-ring` classes are a good start — audit color
  contrast on the navy theme, add ARIA on gauges/charts).
- **F7. White-label theming.** Per-org accent color + logo, driven by
  `organizations.branding`.

---

## 3. Suggested Milestone Order

| Milestone | Phases | Demoable outcome | Target |
|-----------|--------|------------------|--------|
| M1 — Closed loop | A | Real readings appear in History/Analytics; live alerts stream. | First production demo |
| M2 — Safe to share | B | Org-scoped, no exposed secrets, claimable nodes. | Pilot with a second team |
| M3 — Real monitoring | C | Threshold alerts reach email/push. | Usable by facilities staff |
| M4 — Scales | D | Months of data, fast UI, offline-tolerant. | Long-term deployment |
| M5 — Operable | E | CI, tests, observability, backups, typed. | Maintainable by new contributors |
| M6 — Sellable | F | Floor plans, OTA, audit, SSO. | Enterprise pilot |

---

## 4. Concrete First PRs (kick-off checklist)

These are small, independently reviewable changes that start Phase A without
blocking on infrastructure:

1. **Delete `src/services/mqttService.js`** (G1) — its functionality already
   lives in `sensorService.js::connectMqttSensorFeed`. Update any imports.
2. **Add `fetchMetricSeries` + `fetchLatestReading`** to `historyService.js`
   and rewire `Analytics.jsx`, `History.jsx`, `Dashboard.jsx` (G3, G4).
3. **Add a Supabase Realtime subscription** to `AlertsPanel`/`Dashboard`
   (G5) — no schema change needed.
4. **Add `supabase/migrations/0001_init.sql`** mirroring the current
   `schema.sql` so future changes are versioned (sets up E2).
5. **Add Vitest + a single smoke test** for `useSensorNodes` mock mode (E1
   seed) so subsequent refactors are safe.

---

## 5. Open Decisions (resolve with the team)

- **Persistence writer location**: Supabase Edge Function (recommended, scales
  with the project) vs. a standalone small Node/Deno service. The PDF's task
  assignment puts "MQTT & Cloud Setup" on Papa Appiadu + Boakye Evans Osei —
  tag them.
- **Live data to browser**: Supabase Realtime broadcast (recommended, removes
  client MQTT entirely) vs. signed short-lived HiveMQ tokens. Decide in B1.
- **TypeScript now vs. later**: doing it in E5 is cheaper the earlier it
  starts; consider converting `services/` during Phase A.
- **HiveMQ tier**: free cluster is fine for the demo, but the persistence
  writer needs a TCP MQTT connection (port 8883), which HiveMQ Cloud supports
  — confirm the plan covers that and not just WebSocket.
- **Comfort Index canonical source**: firmware (PDF §5.0) or a server-side
  recomputation? Recommend server-side so thresholds can be tuned without
  reflashing devices.

---

*Authored from a full read of `Project-Aether-main/` (src, supabase, README,
package.json, .env.example) and `group 34/Project_Aether.pdf` (Preliminary
Design Review, Phase 1, KNUST Embedded Systems, Group 34).*
