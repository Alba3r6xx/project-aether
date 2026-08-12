-- Project Aether — Migration 0008: Per-device settings (downlink config)
--
-- Until now the ESP32 firmware carried its thresholds, buzzer behaviour and
-- display timing as compile-time constants, so changing a CO2 warning level
-- meant reflashing the device. This migration adds `device_settings`: one row
-- per node holding the desired configuration, which the publish-config Edge
-- Function serialises and publishes to `aether/<node_id>/config` over MQTT.
--
-- Design notes (WHY):
--   * The table is the DESIRED state. `reported_config` / `reported_at` hold
--     what the device echoed back on its state topic, so the UI can show
--     "pending" vs "applied" instead of optimistically lying to the user.
--     Both are nullable — a freshly claimed node has not reported yet.
--   * Every column is constrained at the database level rather than only in
--     the UI, because the config is a downlink to real hardware: an out-of-
--     range quiet-hour or a hazard threshold below the warning threshold
--     would put the firmware into a nonsensical state.
--   * WiFi credentials are deliberately NOT modelled here. They are passed
--     through publish-config in the request body and never persisted in
--     Postgres (see supabase/functions/publish-config/index.ts).
--
-- Run via: supabase db push
-- or apply manually in the Supabase SQL Editor.
--
-- NOTE: numbered 0008 because 0007_audit_fixes.sql already exists.

-- ---------------------------------------------------------------------
-- device_settings — desired config per node, plus last reported state
-- ---------------------------------------------------------------------
create table if not exists device_settings (
  node_id text primary key references nodes(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,

  -- CO2 thresholds in ppm. 400 is roughly outdoor baseline, so anything
  -- below that is a sensor fault rather than a threshold worth setting.
  co2_warn_ppm integer not null default 2000
    check (co2_warn_ppm between 400 and 40000),
  co2_hazard_ppm integer not null default 5000
    check (co2_hazard_ppm between 400 and 50000),

  -- Audible alarm. Sites like classrooms and wards need it muted overnight,
  -- hence the quiet-hours window below.
  buzzer_enabled boolean not null default true,
  quiet_hours_start smallint not null default 22
    check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint not null default 7
    check (quiet_hours_end between 0 and 23),

  -- The ESP32 has no timezone database, so we hand it a fixed UTC offset in
  -- minutes (covers 45-minute zones like Nepal). Range is UTC-12 to UTC+14.
  timezone_offset_minutes smallint not null default 0
    check (timezone_offset_minutes between -720 and 840),

  -- How long each page stays on the OLED before rotating.
  display_page_seconds smallint not null default 5
    check (display_page_seconds between 2 and 60),

  -- What the device last echoed back on its state topic (written by
  -- service_role only — see the RLS note below). Nullable until first report.
  reported_config jsonb,
  reported_at timestamptz,

  updated_at timestamptz not null default now(),

  -- Table-level check: a hazard threshold below the warning threshold would
  -- make the firmware's escalation logic fire in the wrong order.
  constraint device_settings_co2_order_check
    check (co2_hazard_ppm >= co2_warn_ppm)
);

create index if not exists device_settings_org_idx on device_settings (org_id);

alter table device_settings enable row level security;

-- Members of the owning org can read their devices' settings.
-- Mirrors "Members can read nodes in their org" from 0002.
create policy "Members can read device settings in their org"
  on device_settings for select
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  );

-- Only owners/admins may change a device's configuration — mirrors
-- "Admins can manage nodes" from 0002, but split per-command so that the
-- write paths are explicit and auditable.
create policy "Admins can insert device settings"
  on device_settings for insert
  to authenticated
  with check (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

create policy "Admins can update device settings"
  on device_settings for update
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  )
  with check (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

create policy "Admins can delete device settings"
  on device_settings for delete
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

-- NOTE (RLS): the service_role key BYPASSES row level security entirely.
-- That is intentional and is the only path that writes `reported_config` /
-- `reported_at`: the ingest side consumes the device's state topic and
-- records what the hardware actually applied. No authenticated-user policy
-- above grants that, so clients cannot fake a "config applied" state.

-- ---------------------------------------------------------------------
-- Enable Realtime so the settings UI reflects a device's acknowledgement
-- (reported_config) the moment it lands, without polling.
--
-- Guarded so re-running the migration doesn't error with
-- "relation is already member of publication" — same idempotency spirit as
-- the cron.unschedule guards in 0007_audit_fixes.sql.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'device_settings'
  ) then
    alter publication supabase_realtime add table device_settings;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Auto-create default settings for every newly claimed node, so a device
-- always has something to publish and the UI never has to handle a
-- missing-row case. Follows the handle_new_user() pattern from 0002.
-- ---------------------------------------------------------------------
create or replace function handle_new_node()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into device_settings (node_id, org_id)
  values (new.id, new.org_id)
  on conflict (node_id) do nothing;

  return new;
end;
$$;

-- Drop existing trigger if re-running.
drop trigger if exists on_node_created on nodes;
create trigger on_node_created
  after insert on nodes
  for each row execute function handle_new_node();

-- ---------------------------------------------------------------------
-- Backfill: nodes claimed before this migration have no settings row.
-- ---------------------------------------------------------------------
insert into device_settings (node_id, org_id)
select n.id, n.org_id from nodes n
on conflict (node_id) do nothing;
