-- Project Aether — Migration 0007: Remaining audit fixes
--
-- Fixes:
--   M4: Make cron.schedule calls in migration 0005 idempotent by
--       unscheduling before rescheduling. (The original 0004 already
--       does this, but 0005 does not — re-running 0005 would fail.)
--   L1: Mark schema.sql as deprecated (it's kept for reference only;
--       migrations are the source of truth).
--
-- Run via: supabase db push

-- ---------------------------------------------------------------------
-- M4: Unschedule existing cron jobs before rescheduling (idempotent)
-- ---------------------------------------------------------------------

select cron.unschedule('populate-hourly-aggregates') where exists (
  select 1 from cron.job where jobname = 'populate-hourly-aggregates'
);

select cron.unschedule('populate-daily-aggregates') where exists (
  select 1 from cron.job where jobname = 'populate-daily-aggregates'
);

select cron.unschedule('delete-old-raw-readings') where exists (
  select 1 from cron.job where jobname = 'delete-old-raw-readings'
);

-- Reschedule with the same schedules as 0005.
select cron.schedule(
  'populate-hourly-aggregates',
  '0 * * * *',
  $$ select populate_hourly_aggregates(); $$
);

select cron.schedule(
  'populate-daily-aggregates',
  '5 0 * * *',
  $$ select populate_daily_aggregates(); $$
);

select cron.schedule(
  'delete-old-raw-readings',
  '30 2 * * *',
  $$ select delete_old_raw_readings(); $$
);
