/**
 * Central place for client-side configuration.
 *
 * Next.js exposes client-side env vars via `process.env.NEXT_PUBLIC_*`.
 * Anything NOT prefixed with NEXT_PUBLIC_ is server-only and never
 * bundled into the client.
 *
 * SECURITY (closes G7): MQTT broker credentials are NOT here. The browser
 * no longer connects to HiveMQ directly — the ingest-mqtt Edge Function
 * is the sole MQTT subscriber and writer. The browser gets live readings
 * via Supabase Realtime. MQTT broker config lives only in the Edge
 * Function's server-side env vars.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const IS_SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
