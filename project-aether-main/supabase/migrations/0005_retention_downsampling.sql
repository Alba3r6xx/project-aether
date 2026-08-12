-- Project Aether — Migration 0005: Retention & downsampling
--
-- Creates hourly and daily aggregate tables for sensor_readings so the
-- History and Analytics pages can query months of data without scanning
-- millions of raw 5-second rows. A pg_cron job populates the aggregates
-- every hour, and a retention policy deletes raw rows older than 30 days
-- (aggregates are kept indefinitely).
--
-- Closes G9 (no retention policy) and G10 (charts scan raw rows).
--
-- Run via: supabase db push

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- hourly_readings — one row per node per hour (avg/min/max of metrics)
-- ---------------------------------------------------------------------
create table if not exists hourly_readings (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  org_id uuid references organizations(id) on delete cascade,
  hour_bucket timestamptz not null,
  avg_temperature numeric,
  min_temperature numeric,
  max_temperature numeric,
  avg_humidity numeric,
  min_humidity numeric,
  max_humidity numeric,
  avg_heat_index numeric,
  avg_air_quality numeric,
  avg_luminosity numeric,
  reading_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (node_id, hour_bucket)
);

create index if not exists hourly_readings_node_hour_idx
  on hourly_readings (node_id, hour_bucket desc);
create index if not exists hourly_readings_org_idx
  on hourly_readings (org_id, hour_bucket desc);

alter table hourly_readings enable row level security;
create policy "Members can read their org's hourly readings"
  on hourly_readings for select
  to authenticated
  using (
    org_id is null
    or org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- daily_readings — one row per node per day
-- ---------------------------------------------------------------------
create table if not exists daily_readings (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  org_id uuid references organizations(id) on delete cascade,
  day_bucket date not null,
  avg_temperature numeric,
  min_temperature numeric,
  max_temperature numeric,
  avg_humidity numeric,
  min_humidity numeric,
  max_humidity numeric,
  avg_heat_index numeric,
  avg_air_quality numeric,
  avg_luminosity numeric,
  reading_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (node_id, day_bucket)
);

create index if not exists daily_readings_node_day_idx
  on daily_readings (node_id, day_bucket desc);
create index if not exists daily_readings_org_idx
  on daily_readings (org_id, day_bucket desc);

alter table daily_readings enable row level security;
create policy "Members can read their org's daily readings"
  on daily_readings for select
  to authenticated
  using (
    org_id is null
    or org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Aggregate function: populate hourly_readings from the last hour
-- ---------------------------------------------------------------------
create or replace function populate_hourly_aggregates()
returns void
language sql
security definer
set search_path = public
as $$
  insert into hourly_readings (
    node_id, org_id, hour_bucket,
    avg_temperature, min_temperature, max_temperature,
    avg_humidity, min_humidity, max_humidity,
    avg_heat_index, avg_air_quality, avg_luminosity,
    reading_count
  )
  select
    node_id,
    org_id,
    date_trunc('hour', recorded_at) as hour_bucket,
    avg(temperature),
    min(temperature),
    max(temperature),
    avg(humidity),
    min(humidity),
    max(humidity),
    avg(heat_index),
    avg(air_quality),
    avg(luminosity),
    count(*)
  from sensor_readings
  where recorded_at >= date_trunc('hour', now()) - interval '1 hour'
    and recorded_at < date_trunc('hour', now())
  group by node_id, org_id, hour_bucket
  on conflict (node_id, hour_bucket) do update set
    avg_temperature = excluded.avg_temperature,
    min_temperature = excluded.min_temperature,
    max_temperature = excluded.max_temperature,
    avg_humidity = excluded.avg_humidity,
    min_humidity = excluded.min_humidity,
    max_humidity = excluded.max_humidity,
    avg_heat_index = excluded.avg_heat_index,
    avg_air_quality = excluded.avg_air_quality,
    avg_luminosity = excluded.avg_luminosity,
    reading_count = excluded.reading_count;
$$;

-- ---------------------------------------------------------------------
-- Aggregate function: populate daily_readings from hourly_readings
-- ---------------------------------------------------------------------
create or replace function populate_daily_aggregates()
returns void
language sql
security definer
set search_path = public
as $$
  insert into daily_readings (
    node_id, org_id, day_bucket,
    avg_temperature, min_temperature, max_temperature,
    avg_humidity, min_humidity, max_humidity,
    avg_heat_index, avg_air_quality, avg_luminosity,
    reading_count
  )
  select
    node_id,
    org_id,
    date_trunc('day', hour_bucket)::date as day_bucket,
    avg(avg_temperature),
    min(min_temperature),
    max(max_temperature),
    avg(avg_humidity),
    min(min_humidity),
    max(max_humidity),
    avg(avg_heat_index),
    avg(avg_air_quality),
    avg(avg_luminosity),
    sum(reading_count)
  from hourly_readings
  where hour_bucket >= date_trunc('day', now()) - interval '1 day'
    and hour_bucket < date_trunc('day', now())
  group by node_id, org_id, day_bucket
  on conflict (node_id, day_bucket) do update set
    avg_temperature = excluded.avg_temperature,
    min_temperature = excluded.min_temperature,
    max_temperature = excluded.max_temperature,
    avg_humidity = excluded.avg_humidity,
    min_humidity = excluded.min_humidity,
    max_humidity = excluded.max_humidity,
    avg_heat_index = excluded.avg_heat_index,
    avg_air_quality = excluded.avg_air_quality,
    avg_luminosity = excluded.avg_luminosity,
    reading_count = excluded.reading_count;
$$;

-- ---------------------------------------------------------------------
-- Retention: delete raw sensor_readings older than 30 days
-- (aggregates are kept indefinitely)
-- ---------------------------------------------------------------------
create or replace function delete_old_raw_readings()
returns void
language sql
security definer
set search_path = public
as $$
  delete from sensor_readings
  where recorded_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------
-- Schedule cron jobs
-- ---------------------------------------------------------------------
select cron.schedule(
  'populate-hourly-aggregates',
  '0 * * * *',  -- top of every hour
  $$ select populate_hourly_aggregates(); $$
);

select cron.schedule(
  'populate-daily-aggregates',
  '5 0 * * *',  -- 00:05 daily
  $$ select populate_daily_aggregates(); $$
);

select cron.schedule(
  'delete-old-raw-readings',
  '30 2 * * *',  -- 02:30 daily (off-peak)
  $$ select delete_old_raw_readings(); $$
);
