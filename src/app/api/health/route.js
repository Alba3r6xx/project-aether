import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../services/supabaseServer';

export const dynamic = 'force-dynamic';

// AUDIT M22: Health check endpoint for monitoring and uptime checks.
// Returns 200 if the app and database are reachable, 503 otherwise.
export async function GET() {
  const timestamp = new Date().toISOString();
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return NextResponse.json(
      { status: 'degraded', timestamp, database: 'not_configured' },
      { status: 200 }
    );
  }

  try {
    const { error } = await supabase
      .from('sensor_readings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { status: 'unhealthy', timestamp, database: 'error', error: 'query_failed' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { status: 'healthy', timestamp, database: 'connected' },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { status: 'unhealthy', timestamp, database: 'unreachable' },
      { status: 503 }
    );
  }
}
