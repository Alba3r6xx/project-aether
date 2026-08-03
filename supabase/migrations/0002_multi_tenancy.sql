-- Project Aether — Migration 0002: Multi-tenancy & node provisioning
--
-- Adds organizations, org memberships with roles, a nodes table (replacing
-- the hardcoded SENSOR_NODES array), and org-scoped RLS on sensor_readings
-- and alerts (closes G8). Users only see data for organizations they belong
-- to.
--
-- Run via: supabase db push
-- or apply manually in the Supabase SQL Editor.

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

-- A user can see which orgs they belong to (and their role).
create policy "Members can read their own memberships"
  on organization_members for select
  to authenticated
  using (user_id = auth.uid());

-- A user can see the organizations they belong to.
alter table organizations enable row level security;
create policy "Users can read their own organizations"
  on organizations for select
  to authenticated
  using (
    id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
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

-- Users can read nodes in orgs they belong to.
create policy "Members can read nodes in their org"
  on nodes for select
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  );

-- Org admins/owners can insert/update/delete nodes.
create policy "Admins can manage nodes"
  on nodes for all
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

-- ---------------------------------------------------------------------
-- Add org_id to sensor_readings and alerts, rewrite RLS to be org-scoped
-- ---------------------------------------------------------------------

-- Add org_id column (nullable initially so existing rows don't break;
-- the ingest-mqtt Edge Function should set it going forward).
alter table sensor_readings add column if not exists org_id uuid
  references organizations(id) on delete cascade;

create index if not exists sensor_readings_org_idx
  on sensor_readings (org_id, recorded_at desc);

-- Drop the old "any authenticated user reads everything" policy.
drop policy if exists "Authenticated users can read sensor readings"
  on sensor_readings;

-- New org-scoped policy: users only read readings for their orgs.
create policy "Members can read their org's sensor readings"
  on sensor_readings for select
  to authenticated
  using (
    org_id is null  -- backward compat: unscoped rows visible to all
    or org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  );

-- Same for alerts.
alter table alerts add column if not exists org_id uuid
  references organizations(id) on delete cascade;

create index if not exists alerts_org_idx on alerts (org_id, created_at desc);

drop policy if exists "Authenticated users can read alerts"
  on alerts;

create policy "Members can read their org's alerts"
  on alerts for select
  to authenticated
  using (
    org_id is null
    or org_id in (
      select org_id from organization_members
      where user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- Helper: get the current user's primary org_id
-- Useful for Edge Functions and server-side queries.
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

-- Drop existing trigger if re-running.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
