-- Project Aether — Migration 0004: Weekly summary cron job
--
-- Schedules the weekly-summary Edge Function to run every Monday at 08:00 UTC
-- via pg_cron. The cron job calls the Edge Function's HTTP endpoint.
--
-- Prerequisites:
--   - pg_cron extension enabled (Supabase enables it by default on paid plans;
--     for free tier, enable in Dashboard > Database > Extensions).
--   - weekly-summary Edge Function deployed.
--   - pg_net extension enabled for outbound HTTP calls.
--
-- Run via: supabase db push
-- or apply manually in the Supabase SQL Editor.

-- Enable extensions if not already enabled.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- BUG FIX: verify pg_cron is available before scheduling (gives a clear
-- error message instead of a cryptic failure).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron extension must be enabled before running this migration. Enable it in Dashboard > Database > Extensions.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_net extension must be enabled before running this migration. Enable it in Dashboard > Database > Extensions.';
  end if;
end $$;

-- Unschedule if the job already exists (idempotent re-run).
select cron.unschedule('weekly-summary-report') where exists (
  select 1 from cron.job where jobname = 'weekly-summary-report'
);

-- Schedule the weekly summary to run every Monday at 08:00 UTC.
-- The job calls the weekly-summary Edge Function via HTTP.
select cron.schedule(
  'weekly-summary-report',
  '0 8 * * 1',  -- Monday 08:00 UTC
  $$
    select net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/weekly-summary',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Note: the app.supabase_url and app.service_role_key settings are set
-- automatically by Supabase. If they're not available, set them manually:
--   alter database postgres set app.supabase_url to 'https://your-project.supabase.co';
--   alter database postgres set app.service_role_key to 'your-service-role-key';
