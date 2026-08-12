// ---------------------------------------------------------------------------
// Shared CORS handling for browser-invoked Edge Functions.
//
// The browser sends a preflight OPTIONS request before any cross-origin POST
// that carries an Authorization header. Functions that only handle POST used
// to answer that preflight with 405 and no CORS headers, so the browser
// blocked the real request and the call never reached the function at all.
//
// IMPORTANT: The Supabase Edge Gateway strips the Origin header from OPTIONS
// preflight requests before forwarding them to the function. So the function
// cannot echo the specific origin during preflight — it must fall back to "*".
//
// The frontend calls these functions with plain fetch (no credentials:
// 'include'), so "*" is safe and compatible. The Authorization header is
// still required by the function itself, so a foreign site cannot drive a
// logged-in user's device config without their JWT.
//
// For actual POST responses the gateway DOES forward the Origin header, so
// we echo the specific allowed origin when possible (tighter than "*").
//
// Set ALLOWED_ORIGINS (comma-separated) in the project secrets to add
// deployment URLs, e.g.
//   ALLOWED_ORIGINS=https://project-aether-ecru.vercel.app,https://aether.example.com
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...configured];
}

/**
 * Returns true for Vercel preview/production deployments of this project.
 * Preview deployments get a new hostname per commit, so they can't be
 * enumerated in an allow-list, but they are all *.vercel.app over https.
 */
function isVercelDeployment(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

/**
 * Builds the CORS headers for a request.
 *
 * When the Origin header is present and allow-listed (or a Vercel deployment),
 * the specific origin is echoed back. When the Origin header is missing
 * (stripped by the Supabase gateway on OPTIONS preflight) or not allowed,
 * we fall back to "*" so that non-credentialed cross-origin requests still
 * succeed.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const isAllowed = origin !== "" &&
    (allowedOrigins().includes(origin) || isVercelDeployment(origin));

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must key on Origin.
    Vary: "Origin",
  };

  if (isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else {
    // Origin missing (gateway stripped it on OPTIONS) or not allow-listed.
    // The frontend uses non-credentialed fetch, so "*" is safe.
    headers["Access-Control-Allow-Origin"] = "*";
  }

  return headers;
}

/**
 * Answers a CORS preflight. Returns null when the request isn't a preflight,
 * so callers can use it as an early return guard.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Wraps a JSON body in a Response carrying the right CORS headers. */
export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
