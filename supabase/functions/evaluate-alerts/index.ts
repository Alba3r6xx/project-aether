// ---------------------------------------------------------------------------
// Project Aether — Edge Function: evaluate-alerts
//
// Evaluates a sensor reading against alert_rules and inserts into alerts +
// notifications when thresholds are breached (with cooldown enforcement to
// avoid flapping). Closes G6 (no alerting engine) and feeds C2 (notifications).
//
// Called in two ways:
//   1. Directly from ingest-mqtt after each insert (preferred — immediate).
//   2. As an HTTP POST with { reading: {...} } for testing or batch use.
//
// Deploy:
//   supabase functions deploy evaluate-alerts --no-verify-jwt
//
// Env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AUDIT H16/L10: structured logging helper.
function log(level: string, msg: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: "evaluate-alerts", level, msg, ...meta }));
}

interface AlertRule {
  id: string;
  org_id: string | null;
  node_id: string | null;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  cooldown_minutes: number;
  enabled: boolean;
}

interface Reading {
  id?: string;
  node_id: string;
  org_id?: string | null;
  temperature?: number;
  humidity?: number;
  heat_index?: number;
  air_quality?: number;
  luminosity?: number;
  comfort_index?: number;
  comfort_status?: string;
  recorded_at?: string;
}

const OPERATORS: Record<string, (a: number, b: number) => boolean> = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

const METRIC_LABELS: Record<string, string> = {
  temperature: "Temperature",
  humidity: "Humidity",
  air_quality: "Air Quality",
  luminosity: "Luminosity",
  heat_index: "Heat Index",
  comfort_index: "Comfort Index",
};

const METRIC_UNITS: Record<string, string> = {
  temperature: "°C",
  humidity: "%",
  air_quality: "%",
  luminosity: " LUX",
  heat_index: "°C",
  comfort_index: "",
};

/**
 * Evaluates a reading against all enabled alert_rules. Returns the list of
 * breached rules (after cooldown filtering). Also inserts alert + notification
 * rows for each breach.
 */
async function evaluateReading(
  supabase: ReturnType<typeof createClient>,
  reading: Reading
): Promise<{ breaches: number; alerts: number }> {
  // Fetch enabled rules for this org. After migration 0006, org_id is NOT
  // NULL on alert_rules, so we filter at the database level for efficiency
  // and defense-in-depth (BUG FIX: was fetching ALL rules globally and
  // filtering in-memory).
  const { data: rules, error } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("enabled", true)
    .eq("org_id", reading.org_id);

  if (error || !rules) {
    log("error", "Failed to fetch alert_rules", { error: error?.message });
    return { breaches: 0, alerts: 0 };
  }

  let alertsInserted = 0;

  for (const rule of rules as AlertRule[]) {
    // Skip rules for a specific node that doesn't match.
    if (rule.node_id && rule.node_id !== reading.node_id) continue;

    // Get the metric value from the reading.
    const value = reading[rule.metric as keyof Reading] as number | undefined;
    if (value === undefined || value === null) continue;

    // Check if the threshold is breached.
    const op = OPERATORS[rule.operator];
    if (!op || !op(value, rule.threshold)) continue;

    // Cooldown check: was there an alert for THIS RULE + node in the last
    // cooldown_minutes? If so, skip to avoid flapping. (AUDIT C5: was
    // per-node, now per-rule so different rules can fire independently.)
    const cooldownMs = rule.cooldown_minutes * 60 * 1000;
    const since = new Date(Date.now() - cooldownMs).toISOString();

    const { data: recent } = await supabase
      .from("alerts")
      .select("id, created_at")
      .eq("node_id", reading.node_id)
      .eq("rule_id", rule.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      continue; // Still in cooldown for this rule + node
    }

    // Build the alert.
    const metricLabel = METRIC_LABELS[rule.metric] || rule.metric;
    const unit = METRIC_UNITS[rule.metric] || "";
    const opLabel = { gt: "above", gte: "at or above", lt: "below", lte: "at or below" }[rule.operator] || rule.operator;

    const title = `${metricLabel} ${opLabel} ${rule.threshold}${unit}`;
    const description = `${reading.node_id}: ${metricLabel} is ${value}${unit} (threshold: ${rule.operator} ${rule.threshold}${unit}). Rule severity: ${rule.severity}.`;

    // Insert the alert (with rule_id for per-rule cooldown tracking — AUDIT C5).
    // BUG FIX: try with rule_id first; if the column doesn't exist yet
    // (migration 0006 not applied), retry without it so the function
    // doesn't break during deployment ordering.
    let alertData: Record<string, unknown> = {
      node_id: reading.node_id,
      org_id: reading.org_id || null,
      rule_id: rule.id,
      severity: rule.severity,
      title,
      description,
    };

    let { data: alert, error: alertError } = await supabase
      .from("alerts")
      .insert(alertData)
      .select()
      .single();

    // If rule_id column doesn't exist (migration 0006 not yet applied),
    // retry without it.
    if (alertError && alertError.code === "42703") {
      log("warn", "rule_id column not found, retrying without it");
      alertData = {
        node_id: reading.node_id,
        org_id: reading.org_id || null,
        severity: rule.severity,
        title,
        description,
      };
      const retry = await supabase
        .from("alerts")
        .insert(alertData)
        .select()
        .single();
      alert = retry.data;
      alertError = retry.error;
    }

    if (alertError) {
      log("error", "Failed to insert alert", { error: alertError.message, nodeId: reading.node_id });
      continue;
    }

    alertsInserted++;

    // Insert a notification for each org member.
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("org_id", reading.org_id);

    if (members && members.length > 0) {
      const notifications = members.map((m: { user_id: string }) => ({
        org_id: reading.org_id || null,
        user_id: m.user_id,
        alert_id: alert.id,
        title,
        body: description,
        read: false,
      }));

      await supabase.from("notifications").insert(notifications);
    }
  }

  return { breaches: rules.length, alerts: alertsInserted };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    log("error", "Missing env vars", { requestId });
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", requestId }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", requestId }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON", requestId }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const reading: Reading = body.reading || body;
  if (!reading.node_id) {
    return new Response(
      JSON.stringify({ error: "reading.node_id is required", requestId }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await evaluateReading(supabase, reading);

  log("info", "Evaluation complete", { requestId, nodeId: reading.node_id, ...result });

  return new Response(
    JSON.stringify({ status: "evaluated", requestId, ...result }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// Export for use by ingest-mqtt
export { evaluateReading };
