# Project Aether — Codebase Audit Report

**Date:** 2026-07-31
**Scope:** Full audit of `Project-Aether-next/` — security, bugs, gaps, SQL/Edge Functions
**Method:** Four parallel read-only audits covering security, bugs/logic, gaps/deployment readiness, and SQL/Edge Functions

---

## Executive Summary

The codebase is well-structured and Phases A–D are functionally complete. However, there are **critical security and data-integrity issues** that must be fixed before production deployment, along with significant gaps in testing, CI/CD, and observability.

**Finding counts (deduplicated):**
- Critical: 10
- High: 18
- Medium: 22
- Low: 15

---

## CRITICAL Findings

### C1. Cross-org data leak in `weekly-summary` Edge Function
**File:** `supabase/functions/weekly-summary/index.ts` (lines 52–55)
**Found by:** Security audit, Bug hunt, SQL audit (all three)

The function fetches `notification_preferences` without filtering by `org_id`, so users in Org A receive weekly reports containing Org B's data.

```typescript
// BUG: missing .eq("org_id", org.id)
const { data: members } = await supabase
  .from("notification_preferences")
  .select("user_id")
  .eq("weekly_report", true);
```

**Fix:** Add `.eq("org_id", org.id)` to the query.

---

### C2. `ingest-mqtt` doesn't set `org_id` on sensor readings
**File:** `supabase/functions/ingest-mqtt/index.ts` (lines 112–122)
**Found by:** Bug hunt, SQL audit

The normalized payload doesn't include `org_id`. All inserts have `org_id = null`, which means:
1. Readings are invisible to org-scoped queries (the weekly-summary, latest-readings, and fetchNodes all filter by org_id).
2. Due to the `org_id is null` backward-compat clause in RLS, these readings are visible to ALL authenticated users — a data leak.

**Fix:** After parsing `node_id` from the MQTT topic, look up the node's `org_id` from the `nodes` table and include it in the insert.

---

### C3. `org_id is null` in RLS policies creates a data leak path
**File:** `supabase/migrations/0002_multi_tenancy.sql` (lines 123, 143), `supabase/schema.sql`
**Found by:** Security audit, SQL audit

The RLS policies on `sensor_readings`, `alerts`, and `alert_rules` allow `org_id is null` rows to be visible to ALL authenticated users. Combined with C2 (ingest-mqtt doesn't set org_id), every reading is currently world-readable.

**Fix:**
1. Make `org_id` NOT NULL on `sensor_readings`, `alerts`, and `alert_rules` (after fixing ingest-mqtt).
2. Remove the `org_id is null` clause from all RLS policies.
3. Add a trigger to enforce org_id on insert.

---

### C4. Missing foreign key constraints on `node_id` columns
**File:** `supabase/schema.sql`, all migrations
**Found by:** SQL audit

`sensor_readings.node_id`, `alerts.node_id`, and `alert_rules.node_id` have NO foreign key to the `nodes` table. This allows orphaned readings/alerts for non-existent nodes.

**Fix:** Add FK constraints:
```sql
alter table sensor_readings add constraint sensor_readings_node_fkey
  foreign key (node_id) references nodes(id) on delete cascade;
alter table alerts add constraint alerts_node_fkey
  foreign key (node_id) references nodes(id) on delete cascade;
alter table alert_rules add constraint alert_rules_node_fkey
  foreign key (node_id) references nodes(id) on delete cascade;
```

---

### C5. Cooldown logic in `evaluate-alerts` is per-node, not per-rule
**File:** `supabase/functions/evaluate-alerts/index.ts` (lines 112–129)
**Found by:** Bug hunt

The cooldown check queries for ANY recent alert for the node, not for the specific rule. If one rule triggers, ALL rules for that node are suppressed for the cooldown period — even if they breach different thresholds.

**Fix:** Add a `rule_id` column to the `alerts` table and filter by it in the cooldown check, or embed the rule_id in the alert description and parse it.

---

### C6. No CSRF protection on auth forms
**File:** `src/app/login/page.jsx`, `src/app/signup/page.jsx`, `src/app/settings/page.jsx`
**Found by:** Security audit

No CSRF tokens or SameSite cookie enforcement on login, signup, forgot-password, or claim-node forms.

**Fix:** Supabase Auth's `@supabase/ssr` cookie-based sessions should use `SameSite=Lax` (verify the cookie config). For the claim-node Edge Function call, the JWT Bearer token in the Authorization header inherently mitigates CSRF (custom header). For Supabase Auth forms, verify `@supabase/ssr` sets SameSite appropriately.

---

### C7. Missing security headers in `next.config.mjs`
**File:** `next.config.mjs`
**Found by:** Security audit, Gap analysis

No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy headers configured.

**Fix:** Add `headers()` to next.config.mjs with all standard security headers.

---

### C8. N+1 query in `latest-readings` Edge Function
**File:** `supabase/functions/latest-readings/index.ts` (lines 84–108)
**Found by:** Bug hunt, SQL audit

Loops through all nodes making a separate query per node to get the latest reading. With 100 nodes, this is 101 queries.

**Fix:** Create a SQL function using `DISTINCT ON (node_id)` and call it via RPC, or use a single query with a window function.

---

### C9. N+1 query in `fetchNodes` (client and server)
**File:** `src/services/historyService.js` (lines 307–335), `src/services/historyServiceServer.js`
**Found by:** Bug hunt, SQL audit

Same N+1 pattern as C8 — fetches all nodes, then makes a separate query per node for the latest reading.

**Fix:** Same as C8 — use a single query or RPC.

---

### C10. No CI/CD pipeline, no Supabase CLI config, no deployment automation
**Found by:** Gap analysis

No `.github/workflows/`, no `supabase/config.toml`, no deployment scripts. Migrations and Edge Functions must be deployed manually.

**Fix:** Create a GitHub Actions CI workflow (lint, test, build) and a `supabase/config.toml`. Add `npm run deploy:functions` script.

---

## HIGH Findings

### H1. Unhandled promise rejections in DashboardClient
**File:** `src/app/dashboard/DashboardClient.jsx` (lines 36–60)
**Found by:** Bug hunt

Three `useEffect` hooks call async functions (fetchAlerts, fetchLatestReading, fetchMetricSeries) without `.catch()` handlers. If Supabase is unreachable, these produce unhandled promise rejections.

**Fix:** Add `.catch()` to all async chains.

### H2. State update after unmount in `useSensorNodes`
**File:** `src/hooks/useSensorNodes.js` (lines 57–63)
**Found by:** Bug hunt

The `refresh` function doesn't guard against state updates after unmount.

**Fix:** Use a `mounted` flag or AbortController.

### H3. Missing INSERT/UPDATE/DELETE RLS policies on data tables
**File:** `supabase/schema.sql`, migrations 0002, 0005
**Found by:** SQL audit

Only SELECT policies exist on `sensor_readings`, `alerts`, `hourly_readings`, `daily_readings`. While writes come from the service_role key (bypassing RLS), there's no explicit DENY for authenticated users.

**Fix:** Add `using (false)` policies for INSERT/UPDATE/DELETE on all data tables.

### H4. Missing indexes on hot query paths
**File:** Various migrations
**Found by:** SQL audit

Missing indexes:
- `alerts(node_id, created_at desc)` — evaluate-alerts queries by node_id
- `notifications(alert_id)` — join queries
- `notification_preferences(org_id)` — weekly-summary queries
- `alert_rules(metric, enabled)` — rule lookups
- `alerts(severity, created_at desc)` — dashboard filtering

**Fix:** Add the missing indexes.

### H5. No concurrency protection on cron jobs
**File:** `supabase/migrations/0005_retention_downsampling.sql`
**Found by:** SQL audit

If a cron job takes longer than its interval, multiple instances run simultaneously. pg_cron doesn't prevent this by default.

**Fix:** Use `pg_try_advisory_xact_lock()` in the aggregate functions.

### H6. No MQTT reconnection backoff
**File:** `supabase/functions/ingest-mqtt/index.ts` (lines 153–160)
**Found by:** SQL audit

Fixed 3-second reconnect period. During extended broker outages, this creates a connection storm.

**Fix:** Implement exponential backoff.

### H7. No timeout on fetch to `evaluate-alerts` from `ingest-mqtt`
**File:** `supabase/functions/ingest-mqtt/index.ts` (lines 212–227)
**Found by:** SQL audit

If `evaluate-alerts` hangs, it blocks MQTT message processing indefinitely.

**Fix:** Add `signal: AbortSignal.timeout(5000)` to the fetch call.

### H8. No graceful degradation when Supabase is unreachable
**File:** Multiple files
**Found by:** Bug hunt

`IS_SUPABASE_CONFIGURED` only checks if env vars are set, not if the service is reachable. When configured but offline, the app shows empty states with no indication of the error.

**Fix:** Add a health check function and surface connection errors to the user.

### H9. Realtime disconnect not handled
**File:** `src/hooks/useSensorNodes.js` (lines 77–98)
**Found by:** Bug hunt

If the Realtime connection drops, `connectionStatus` stays at 'connected'. No reconnection logic or disconnect event handler.

**Fix:** Use the `.subscribe((status) => ...)` callback to track SUBSCRIBED/CLOSED/CHANNEL_ERROR states.

### H10. Race condition in `claim-node` Edge Function
**File:** `supabase/functions/claim-node/index.ts` (lines 102–120)
**Found by:** Bug hunt, SQL audit

The check-then-insert pattern is not atomic. Two concurrent requests could both pass the duplicate check.

**Fix:** Rely on the primary key constraint and handle the `23505` unique violation error code.

### H11. Missing keyboard navigation and focus management
**File:** `src/components/NotificationBell/NotificationBell.jsx`, `src/components/Navbar/Navbar.jsx`
**Found by:** Gap analysis

Interactive elements lack `onKeyDown` handlers. The notification dropdown has no focus trap or Esc-to-close.

**Fix:** Add keyboard event handlers and focus trap for the dropdown.

### H12. Missing ARIA labels on charts and gauges
**File:** `src/components/ChartCard/ChartCard.jsx`, `src/components/ComfortGauge/ComfortGauge.jsx`
**Found by:** Gap analysis

Charts lack `role="img"` and `aria-label`. Gauges lack `role="progressbar"` and `aria-valuenow`.

**Fix:** Add appropriate ARIA attributes.

### H13. README.md has outdated env var documentation
**File:** `README.md` (lines 70–86)
**Found by:** Gap analysis

Still references removed MQTT env vars (`NEXT_PUBLIC_MQTT_*`, `NEXT_PUBLIC_WEBSOCKET_URL`). Still lists `mqtt.js` as a dependency.

**Fix:** Update README to match current `.env.example` and `package.json`.

### H14. No rate limiting on `claim-node` Edge Function
**File:** `supabase/functions/claim-node/index.ts`
**Found by:** SQL audit

A malicious user could brute-force claim all available node IDs.

**Fix:** Implement rate limiting (per-user counter in a table, or Supabase's built-in rate limiting).

### H15. No error tracking (Sentry) or analytics
**Found by:** Gap analysis

No error tracking or analytics configured. Production errors are invisible.

**Fix:** Add Sentry for frontend + Edge Functions. Add privacy-friendly analytics (Plausible/PostHog).

### H16. No structured logging in Edge Functions
**File:** All Edge Functions
**Found by:** Gap analysis, SQL audit

All logging is `console.log`/`console.error` with no structure. Hard to query in production.

**Fix:** Use structured JSON logging with timestamps, service names, and correlation IDs.

### H17. Missing error states on SSR pages
**File:** `src/app/analytics/page.jsx`, `src/app/history/page.jsx`, `src/app/dashboard/page.jsx`
**Found by:** Gap analysis

Server-side fetches have no try/catch. If Supabase fails, pages render blank with no error message.

**Fix:** Wrap server fetches in try/catch and render an error state.

### H18. No E2E tests
**Found by:** Gap analysis

No Playwright/Cypress tests. Critical user flows (login, dashboard, node claim, alert delivery) are untested.

**Fix:** Add Playwright E2E tests for critical paths.

---

## MEDIUM Findings

| # | Finding | File(s) |
|---|---------|---------|
| M1 | Supabase errors silently swallowed (logged but return empty) | historyService.js |
| M2 | `org_id` nullable on `alert_rules` with RLS leak | 0003_alerting.sql |
| M3 | Seed data in 0003 uses null org_id (global rules visible to all) | 0003_alerting.sql |
| M4 | Migration cron.schedule calls not idempotent (re-run fails) | 0004, 0005 |
| M5 | Missing GRANT statements on SECURITY DEFINER functions | 0002, 0005 |
| M6 | Cache poisoning risk in service worker (API responses cached) | public/sw.js |
| M7 | `/settings` route cached by service worker (user-specific data) | public/sw.js |
| M8 | `generatedAt` in latest-readings response defeats caching | latest-readings/index.ts |
| M9 | NaN propagation in chart data (null values cause gaps) | historyService.js |
| M10 | Date timezone handling assumes client TZ matches server | historyService.js |
| M11 | Aggregation math in weekly-summary treats null as 0 | weekly-summary/index.ts |
| M12 | Missing input range validation on MQTT payload | ingest-mqtt/index.ts |
| M13 | Missing input validation on claim-node (length, format) | claim-node/index.ts |
| M14 | Verbose error logging in production (console.error everywhere) | historyService.js, historyServiceServer.js |
| M15 | Error messages from DB returned to client in claim-node | claim-node/index.ts |
| M16 | `sensor_readings` in Realtime publication (high traffic at 5s/node) | schema.sql |
| M17 | Missing pagination in weekly-summary (fetches all week's readings) | weekly-summary/index.ts |
| M18 | Missing pagination in evaluate-alerts (fetches all rules) | evaluate-alerts/index.ts |
| M19 | Unused `axios` dependency | package.json |
| M20 | Missing PWA icons (referenced but don't exist) | public/manifest.json |
| M21 | Missing image optimization config (Unsplash not allowlisted) | next.config.mjs |
| M22 | No health check endpoint | — |

---

## LOW Findings

| # | Finding | File(s) |
|---|---------|---------|
| L1 | schema.sql exists alongside migrations (confusing) | supabase/ |
| L2 | Seed data in schema.sql creates orphaned rows (no nodes exist yet) | schema.sql |
| L3 | Missing skip-to-content link | layout.jsx |
| L4 | Color contrast not verified for WCAG compliance | — |
| L5 | No robots.txt or sitemap.xml | public/ |
| L6 | No Dockerfile | — |
| L7 | No architecture documentation | — |
| L8 | No contributing guidelines | — |
| L9 | No environment-specific config examples | — |
| L10 | No request ID correlation in Edge Function logs | all functions |
| L11 | No Web Vitals / performance monitoring | — |
| L12 | Inconsistent error response formats across Edge Functions | all functions |
| L13 | All strings hardcoded in English (no i18n) | all components |
| L14 | No TypeScript (JS with jsconfig.json) | — |
| L15 | Demo mode bypasses auth when Supabase unconfigured | middleware.js |

---

## Positive Findings

The audits confirmed several strengths:
- No hardcoded secrets in source code
- Correct `NEXT_PUBLIC_` prefix usage (server secrets don't leak to client)
- No `dangerouslySetInnerHTML` or `innerHTML` usage (XSS-safe)
- JWT verification in user-facing Edge Functions (claim-node, latest-readings)
- SQL injection protection (all queries use Supabase query builder)
- Error boundary with dev-only stack traces
- Proper `.gitignore` for env files
- Password strength validation on signup
- Good empty state handling on most pages
- Well-structured service layer (client/server separation)
- Virtualized DataTable (no new dependency)
- Memoized ChartCard and sparklines

---

## Recommended Fix Priority

### Immediate (before any production deployment)
1. **C1**: Fix weekly-summary org_id filter (1-line fix)
2. **C2**: Fix ingest-mqtt to set org_id on readings
3. **C3**: Make org_id NOT NULL, remove `org_id is null` from RLS
4. **C4**: Add foreign key constraints on node_id columns
5. **C5**: Fix cooldown logic to be per-rule, not per-node
6. **C7**: Add security headers to next.config.mjs
7. **C8/C9**: Fix N+1 queries in latest-readings and fetchNodes
8. **H1**: Add .catch() to all async chains in DashboardClient

### Short-term (this sprint)
9. **C6**: Verify/fix CSRF protection and cookie SameSite
10. **C10**: Set up CI/CD + Supabase CLI config
11. **H3**: Add explicit DENY RLS policies for writes
12. **H4**: Add missing database indexes
13. **H5**: Add advisory locks to cron jobs
14. **H7**: Add timeout to evaluate-alerts fetch call
15. **H8/H9**: Add Supabase health check + Realtime disconnect handling
16. **H13**: Update README.md
17. **H17**: Add error states to SSR pages

### Medium-term (next quarter)
18. **H10/H14**: Fix claim-node race condition + add rate limiting
19. **H15/H16**: Add Sentry + structured logging
20. **H18**: Add E2E tests
21. **H11/H12**: Accessibility improvements (keyboard nav, ARIA)
22. **M1–M22**: Address medium findings

---

*This report was generated by four parallel read-only audits. No files were modified during the audit.*
