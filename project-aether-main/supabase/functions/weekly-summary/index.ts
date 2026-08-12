// ---------------------------------------------------------------------------
// Project Aether — Edge Function: weekly-summary
//
// Aggregates the past week's sensor readings + alerts into a summary and
// creates a notification for each org member who opted into weekly reports.
// Triggered by a pg_cron job (see migration 0004).
//
// Deploy:
//   supabase functions deploy weekly-summary --no-verify-jwt
//
// Env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT H16/L10: structured logging helper with request ID correlation.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "weekly-summary", level, msg, ...meta }));
}

Deno.serve(async (_req: Request) => {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    log("error", "Missing env vars", { requestId });
    return new Response(
      JSON.stringify({ error: "Missing env vars", requestId }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all orgs.
  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name");

  if (orgsError || !orgs) {
    log("error", "Failed to fetch orgs", { requestId, error: orgsError?.message });
    return new Response(JSON.stringify({ error: "Failed to fetch orgs", requestId }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let reportsSent = 0;
  const PAGE_SIZE = 1000; // AUDIT M17: paginate readings to avoid fetching all at once.

  for (const org of orgs) {
    // Fetch members who opted into weekly reports (filtered by org_id to
    // prevent cross-org data leaks — AUDIT C1).
    const { data: members } = await supabase
      .from("notification_preferences")
      .select("user_id")
      .eq("org_id", org.id)
      .eq("weekly_report", true);

    if (!members || members.length === 0) continue;

    // AUDIT M17: paginate the week's readings to avoid loading all rows
    // at once for orgs with high sensor traffic.
    const allReadings: any[] = [];
    let offset = 0;
    while (true) {
      const { data: page } = await supabase
        .from("sensor_readings")
        .select("temperature, humidity, air_quality, comfort_status")
        .eq("org_id", org.id)
        .gte("recorded_at", oneWeekAgo)
        .range(offset, offset + PAGE_SIZE - 1);
      if (!page || page.length === 0) break;
      allReadings.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    const readings = allReadings;

    // Count alerts for this org.
    const { count: alertCount } = await supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org.id)
      .gte("created_at", oneWeekAgo);

    if (readings.length === 0) continue;

    // AUDIT M11: skip null/undefined values instead of treating them as 0.
    const avg = (key: string) => {
      const values = readings
        .map((r) => Number(r[key]))
        .filter((v) => !isNaN(v));
      if (values.length === 0) return null;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };

    const optimalCount = readings.filter((r) => r.comfort_status === "OPTIMAL").length;
    const fairCount = readings.filter((r) => r.comfort_status === "FAIR").length;
    const poorCount = readings.filter((r) => r.comfort_status === "POOR").length;

    // BUG FIX: avg() can return null if all values are null — use
    // null-safe formatting instead of calling .toFixed(1) on null.
    const fmt = (val: number | null) => (val !== null ? val.toFixed(1) : "N/A");

    const title = `Weekly Summary: ${org.name}`;
    const body = [
      `${readings.length} readings recorded this week.`,
      `Avg temperature: ${fmt(avg("temperature"))}°C`,
      `Avg humidity: ${fmt(avg("humidity"))}%`,
      `Avg air quality: ${fmt(avg("air_quality"))}%`,
      `Comfort: ${optimalCount} optimal, ${fairCount} fair, ${poorCount} poor.`,
      `${alertCount || 0} alerts triggered.`,
    ].join(" | ");

    // Create a notification for each opted-in member.
    const notifications = members.map((m: { user_id: string }) => ({
      org_id: org.id,
      user_id: m.user_id,
      title,
      body,
      read: false,
    }));

    const { error: notifError } = await supabase
      .from("notifications")
      .insert(notifications);

    if (notifError) {
      log("error", "Failed to insert notifications", { requestId, orgId: org.id, error: notifError.message });
    } else {
      reportsSent += notifications.length;
    }
  }

  log("info", "Weekly summary complete", { requestId, reportsSent, orgCount: orgs.length });

  return new Response(
    JSON.stringify({ status: "complete", reportsSent, orgs: orgs.length, requestId }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
