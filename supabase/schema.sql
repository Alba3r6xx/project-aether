-- Project Aether - Supabase schema (DEPRECATED - AUDIT L1/L2)
--
-- WARNING: This file is kept for REFERENCE ONLY. The source of truth is
-- the versioned migrations in supabase/migrations/ (0001-0007).
-- Do NOT run this file in production - it contains seed data with
-- orphaned rows (L2) and does not reflect the latest schema changes
-- (RLS hardening, FK constraints, org_id NOT NULL, etc.).
--
-- To set up a fresh database, run the migrations in order:
--   supabase db push
--
-- This file was the original single-file schema before the migration
-- system was introduced. It is preserved here for historical context.
--
-- Covers: organizations, org memberships, nodes, sensor readings, alerts.
-- RLS is org-scoped: users only see data for orgs they belong to (closes G8).
-- Writes come from the ingest-mqtt Edge Function (service_role key), never
-- from the browser.
--
-- The comfort_index column stores the Steadman Heat Index (C) computed
-- by the Edge Function. comfort_status stores the OPTIMAL/FAIR/POOR
-- classification from the 5.0 thresholds.

-- ---------------------------------------------------------------------
-- organizations — one per customer/team
-- ---------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- organization_members — user ↔ org with role
-- ---------------------------------------------------------------------
create table if not exists organization_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx
  on organization_members (user_id);

alter table organization_members enable row level security;
create policy "Members can read their own memberships"
  on organization_members for select
  to authenticated
  using (user_id = auth.uid());

alter table organizations enable row level security;
create policy "Users can read their own organizations"
  on organizations for select
  to authenticated
  using (
    id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- nodes — replaces the hardcoded SENSOR_NODES array (closes G14)
-- ---------------------------------------------------------------------
create table if not exists nodes (
  id text primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  room text,
  floor text,
  location text,
  firmware_version text,
  claimed_at timestamptz not null default now()
);

create index if not exists nodes_org_idx on nodes (org_id);

alter table nodes enable row level security;
create policy "Members can read nodes in their org"
  on nodes for select
  to authenticated
  using (
    org_id in (select org_id from organization_members where user_id = auth.uid())
  );
create policy "Admins can manage nodes"
  on nodes for all
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------
-- sensor_readings — one row per ESP32 MQTT message (every 5s per node)
-- ---------------------------------------------------------------------
create table if not exists sensor_readings (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  org_id uuid references organizations(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  temperature numeric,
  humidity numeric,
  heat_index numeric,
  air_quality numeric,
  luminosity numeric,
  comfort_index numeric,
  comfort_status text check (comfort_status in ('OPTIMAL', 'FAIR', 'POOR'))
);

create index if not exists sensor_readings_recorded_at_idx
  on sensor_readings (recorded_at desc);
create index if not exists sensor_readings_node_idx
  on sensor_readings (node_id, recorded_at desc);
create index if not exists sensor_readings_org_idx
  on sensor_readings (org_id, recorded_at desc);

alter table sensor_readings enable row level security;
create policy "Members can read their org's sensor readings"
  on sensor_readings for select
  to authenticated
  using (
    org_id is null
    or org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- alerts — threshold breaches (Phase C will add the alerting engine)
-- ---------------------------------------------------------------------
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  org_id uuid references organizations(id) on delete cascade,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists alerts_created_at_idx
  on alerts (created_at desc);
create index if not exists alerts_org_idx
  on alerts (org_id, created_at desc);

alter table alerts enable row level security;
create policy "Members can read their org's alerts"
  on alerts for select
  to authenticated
  using (
    org_id is null
    or org_id in (select org_id from organization_members where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Realtime: live alerts + live readings without mqtt.js in the browser
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table alerts;
alter publication supabase_realtime add table sensor_readings;

-- ---------------------------------------------------------------------
-- Helper: get the current user's primary org_id
-- ---------------------------------------------------------------------
create or replace function get_user_org_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from organization_members
  where user_id = p_user_id
  order by created_at asc
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Auto-create a personal org for new users on signup
-- ---------------------------------------------------------------------
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Optional: seed rows so pages aren't empty before real data arrives.
-- Safe to delete once real readings are flowing in.
-- NOTE: After migration 0006, org_id is NOT NULL on sensor_readings and
-- alerts. The seed creates a test org and nodes first, then inserts
-- readings/alerts scoped to that org.
-- ---------------------------------------------------------------------
insert into organizations (name) values ('Seed Organization')
  on conflict do nothing;

insert into nodes (id, org_id, name, room)
values
  ('node-01', (select id from organizations where name = 'Seed Organization'), 'ESP32 - node-01', 'Living Room'),
  ('node-03', (select id from organizations where name = 'Seed Organization'), 'ESP32 - node-03', 'Kitchen')
on conflict do nothing;

insert into sensor_readings (node_id, org_id, temperature, humidity, heat_index, air_quality, luminosity, comfort_index, comfort_status)
values
  ('node-01', (select id from organizations where name = 'Seed Organization'), 26, 57, 27.1, 42, 2206, 27.1, 'FAIR'),
  ('node-01', (select id from organizations where name = 'Seed Organization'), 25.4, 55, 26.3, 40, 2100, 26.3, 'FAIR')
on conflict do nothing;

insert into alerts (node_id, org_id, severity, title, description)
values
  ('node-03', (select id from organizations where name = 'Seed Organization'), 'warning', 'Air quality dropping in Kitchen', 'MQ-135 reading crossed 38 AQI, ventilation recommended.')
on conflict do nothing;
