-- Project Aether — Migration 0006: Data integrity & security hardening
--
-- Fixes from the codebase audit:
--   C3: Make org_id NOT NULL on sensor_readings, alerts, alert_rules;
--       remove the `org_id is null` backward-compat clause from RLS policies
--       (was a data leak: unscoped rows visible to ALL authenticated users).
--   C4: Add foreign key constraints on node_id columns to prevent orphaned
--       readings/alerts/rules for non-existent nodes.
--   C5: Add rule_id column to alerts so evaluate-alerts can enforce per-rule
--       cooldown instead of per-node cooldown (which suppressed all rules
--       for a node when any one rule fired).
--   H3: Add explicit DENY policies for INSERT/UPDATE/DELETE on data tables
--       so authenticated users can't write directly (only service_role can).
--   H4: Add missing indexes on hot query paths.
--
-- IMPORTANT: Apply this AFTER ingest-mqtt has been updated to always set
-- org_id on inserts (C2 fix). If existing rows have null org_id, backfill
-- them first:
--   update sensor_readings set org_id = (select org_id from nodes where
--   nodes.id = sensor_readings.node_id) where org_id is null;
--   delete from sensor_readings where org_id is null;  -- orphaned rows
--
-- Run via: supabase db push

-- ---------------------------------------------------------------------
-- C4: Foreign key constraints on node_id columns
-- ---------------------------------------------------------------------

-- sensor_readings.node_id → nodes.id
-- (only add if nodes table exists; it's created in migration 0002)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'nodes') then
    if not exists (
      select 1 from information_schema.table_constraints
      where constraint_name = 'sensor_readings_node_id_fkey'
    ) then
      -- First clean up orphaned readings that reference non-existent nodes
      delete from sensor_readings
      where node_id not in (select id from nodes);

      alter table sensor_readings
        add constraint sensor_readings_node_id_fkey
        foreign key (node_id) references nodes(id) on delete cascade;
    end if;

    if not exists (
      select 1 from information_schema.table_constraints
      where constraint_name = 'alerts_node_id_fkey'
    ) then
      delete from alerts
      where node_id not in (select id from nodes);

      alter table alerts
        add constraint alerts_node_id_fkey
        foreign key (node_id) references nodes(id) on delete cascade;
    end if;

    if not exists (
      select 1 from information_schema.table_constraints
      where constraint_name = 'alert_rules_node_id_fkey'
    ) then
      delete from alert_rules
      where node_id is not null and node_id not in (select id from nodes);

      alter table alert_rules
        add constraint alert_rules_node_id_fkey
        foreign key (node_id) references nodes(id) on delete cascade;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- C3: Make org_id NOT NULL (after backfilling/cleaning orphaned rows)
-- ---------------------------------------------------------------------

-- Backfill sensor_readings.org_id from nodes table where possible.
update sensor_readings sr
  set org_id = n.org_id
  from nodes n
  where sr.node_id = n.id and sr.org_id is null;

-- Delete any remaining unscoped readings (orphaned nodes with no org).
delete from sensor_readings where org_id is null;

-- Backfill alerts.org_id from nodes table.
update alerts a
  set org_id = n.org_id
  from nodes n
  where a.node_id = n.id and a.org_id is null;

delete from alerts where org_id is null;

-- For alert_rules, set org_id on global rules to a sentinel or delete them.
-- Global rules (org_id = null) were seeded in 0003; we'll delete them since
-- each org should manage its own rules.
delete from alert_rules where org_id is null;

-- Now make org_id NOT NULL.
alter table sensor_readings alter column org_id set not null;
alter table alerts alter column org_id set not null;
alter table alert_rules alter column org_id set not null;

-- BUG FIX (scan v3 #1): also make org_id NOT NULL on hourly_readings and
-- daily_readings — these were missed in the initial 0006, leaving a data
-- leak path via the org_id-is-null RLS clause.
update hourly_readings hr
  set org_id = sr.org_id
  from sensor_readings sr
  where hr.node_id = sr.node_id
    and hr.hour_bucket = date_trunc('hour', sr.recorded_at)
    and hr.org_id is null;

delete from hourly_readings where org_id is null;

update daily_readings dr
  set org_id = hr.org_id
  from hourly_readings hr
  where dr.node_id = hr.node_id
    and dr.day_bucket = date_trunc('day', hr.hour_bucket)::date
    and dr.org_id is null;

delete from daily_readings where org_id is null;

alter table hourly_readings alter column org_id set not null;
alter table daily_readings alter column org_id set not null;

-- BUG FIX (scan v3 #3): make org_id NOT NULL on notification_preferences
-- and backfill from organization_members.
update notification_preferences np
  set org_id = om.org_id
  from organization_members om
  where np.user_id = om.user_id and np.org_id is null;

delete from notification_preferences where org_id is null;

alter table notification_preferences alter column org_id set not null;

-- BUG FIX (scan v3 #3): update handle_new_user() to also create a
-- notification_preferences row on signup so users have defaults.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _org_id uuid;
begin
  insert into organizations (name)
  values (coalesce(new.raw_user_meta_data->>'full_name', 'My Organization'))
  returning id into _org_id;

  insert into organization_members (org_id, user_id, role)
  values (_org_id, new.id, 'owner');

  insert into notification_preferences (user_id, org_id, email, push, weekly_report)
  values (new.id, _org_id, true, true, false)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- C3: Remove the `org_id is null` backward-compat clause from RLS policies
-- ---------------------------------------------------------------------

drop policy if exists "Members can read their org's sensor readings"
  on sensor_readings;
create policy "Members can read their org's sensor readings"
  on sensor_readings for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );

drop policy if exists "Members can read their org's alerts"
  on alerts;
create policy "Members can read their org's alerts"
  on alerts for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );

drop policy if exists "Members can read alert rules in their org"
  on alert_rules;
create policy "Members can read alert rules in their org"
  on alert_rules for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- Same for hourly_readings and daily_readings (remove null clause).
drop policy if exists "Members can read their org's hourly readings"
  on hourly_readings;
create policy "Members can read their org's hourly readings"
  on hourly_readings for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );

drop policy if exists "Members can read their org's daily readings"
  on daily_readings;
create policy "Members can read their org's daily readings"
  on daily_readings for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- H3: Explicit DENY policies for INSERT/UPDATE/DELETE on data tables.
-- Writes should only come from the service_role key (Edge Functions),
-- which bypasses RLS. These policies ensure authenticated users can't
-- write directly even if RLS is misconfigured.
-- ---------------------------------------------------------------------

create policy "Deny direct inserts to sensor_readings"
  on sensor_readings for insert to authenticated with check (false);
create policy "Deny direct updates to sensor_readings"
  on sensor_readings for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to sensor_readings"
  on sensor_readings for delete to authenticated using (false);

create policy "Deny direct inserts to alerts"
  on alerts for insert to authenticated with check (false);
create policy "Deny direct updates to alerts"
  on alerts for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to alerts"
  on alerts for delete to authenticated using (false);

create policy "Deny direct inserts to hourly_readings"
  on hourly_readings for insert to authenticated with check (false);
create policy "Deny direct updates to hourly_readings"
  on hourly_readings for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to hourly_readings"
  on hourly_readings for delete to authenticated using (false);

create policy "Deny direct inserts to daily_readings"
  on daily_readings for insert to authenticated with check (false);
create policy "Deny direct updates to daily_readings"
  on daily_readings for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to daily_readings"
  on daily_readings for delete to authenticated using (false);

-- BUG FIX (scan v3 #2): add DENY policies for notifications and
-- notification_preferences — these are written by Edge Functions with
-- service_role, so authenticated users should never write directly.
create policy "Deny direct inserts to notifications"
  on notifications for insert to authenticated with check (false);
create policy "Deny direct updates to notifications"
  on notifications for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to notifications"
  on notifications for delete to authenticated using (false);

create policy "Deny direct inserts to notification_preferences"
  on notification_preferences for insert to authenticated with check (false);
create policy "Deny direct updates to notification_preferences"
  on notification_preferences for update to authenticated using (false) with check (false);
create policy "Deny direct deletes to notification_preferences"
  on notification_preferences for delete to authenticated using (false);

-- ---------------------------------------------------------------------
-- C5: Add rule_id to alerts for per-rule cooldown
-- ---------------------------------------------------------------------

alter table alerts add column if not exists rule_id uuid;

create index if not exists alerts_rule_node_idx
  on alerts (rule_id, node_id, created_at desc);

-- ---------------------------------------------------------------------
-- H4: Missing indexes on hot query paths
-- ---------------------------------------------------------------------

create index if not exists alerts_node_created_idx
  on alerts (node_id, created_at desc);

create index if not exists notifications_alert_id_idx
  on notifications (alert_id);

create index if not exists notification_preferences_org_idx
  on notification_preferences (org_id);

create index if not exists alert_rules_metric_enabled_idx
  on alert_rules (metric, enabled);

create index if not exists alerts_severity_created_idx
  on alerts (severity, created_at desc);

create index if not exists org_members_user_created_idx
  on organization_members (user_id, created_at asc);

-- ---------------------------------------------------------------------
-- H5: Advisory locks for cron jobs (prevent concurrent execution)
-- ---------------------------------------------------------------------

create or replace function populate_hourly_aggregates()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_try_advisory_xact_lock(hashtext('populate_hourly_aggregates')) then
    insert into hourly_readings (
      node_id, org_id, hour_bucket,
      avg_temperature, min_temperature, max_temperature,
      avg_humidity, min_humidity, max_humidity,
      avg_heat_index, avg_air_quality, avg_luminosity,
      reading_count
    )
    select
      node_id, org_id,
      date_trunc('hour', recorded_at) as hour_bucket,
      avg(temperature), min(temperature), max(temperature),
      avg(humidity), min(humidity), max(humidity),
      avg(heat_index), avg(air_quality), avg(luminosity),
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
  end if;
end;
$$;

create or replace function populate_daily_aggregates()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_try_advisory_xact_lock(hashtext('populate_daily_aggregates')) then
    insert into daily_readings (
      node_id, org_id, day_bucket,
      avg_temperature, min_temperature, max_temperature,
      avg_humidity, min_humidity, max_humidity,
      avg_heat_index, avg_air_quality, avg_luminosity,
      reading_count
    )
    select
      node_id, org_id,
      date_trunc('day', hour_bucket)::date as day_bucket,
      avg(avg_temperature), min(min_temperature), max(max_temperature),
      avg(avg_humidity), min(min_humidity), max(max_humidity),
      avg(avg_heat_index), avg(avg_air_quality), avg(avg_luminosity),
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
  end if;
end;
$$;

-- Grant execute to service_role (pg_cron runs as service_role).
grant execute on function populate_hourly_aggregates() to service_role;
grant execute on function populate_daily_aggregates() to service_role;
grant execute on function delete_old_raw_readings() to service_role;
grant execute on function get_user_org_id(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- C8/C9: RPC function for latest reading per node (eliminates N+1 queries)
-- ---------------------------------------------------------------------
create or replace function get_latest_readings_per_node(p_org_id uuid)
returns table (
  node_id text,
  node_name text,
  room text,
  floor text,
  location text,
  firmware_version text,
  temperature numeric,
  humidity numeric,
  heat_index numeric,
  air_quality numeric,
  luminosity numeric,
  comfort_status text,
  recorded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (sr.node_id)
    sr.node_id,
    n.name as node_name,
    n.room,
    n.floor,
    n.location,
    n.firmware_version,
    sr.temperature,
    sr.humidity,
    sr.heat_index,
    sr.air_quality,
    sr.luminosity,
    sr.comfort_status,
    sr.recorded_at
  from sensor_readings sr
  join nodes n on n.id = sr.node_id
  where n.org_id = p_org_id
    and sr.org_id = p_org_id
  order by sr.node_id, sr.recorded_at desc;
$$;

grant execute on function get_latest_readings_per_node(uuid) to authenticated;
