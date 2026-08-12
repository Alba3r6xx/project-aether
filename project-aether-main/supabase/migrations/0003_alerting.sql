-- Project Aether — Migration 0003: Alerting engine
--
-- Adds the alert_rules table (per-node threshold rules with cooldown) and
-- a notifications table (in-app toast/bell with unread count). The
-- evaluate-alerts Edge Function reads rules from alert_rules, evaluates
-- each new sensor_reading against them, and inserts into alerts + notifications
-- when thresholds are breached (respecting cooldown to avoid flapping).
--
-- Run via: supabase db push

-- ---------------------------------------------------------------------
-- alert_rules — threshold rules evaluated on every new reading
-- ---------------------------------------------------------------------
create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  node_id text,                       -- null = applies to all nodes in the org
  metric text not null check (metric in ('temperature', 'humidity', 'air_quality', 'luminosity', 'heat_index', 'comfort_index')),
  operator text not null check (operator in ('gt', 'gte', 'lt', 'lte')),
  threshold numeric not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  cooldown_minutes integer not null default 30,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists alert_rules_org_node_idx
  on alert_rules (org_id, node_id, enabled);

alter table alert_rules enable row level security;

-- Users can read/manage rules for their org.
create policy "Members can read alert rules in their org"
  on alert_rules for select
  to authenticated
  using (
    org_id is null
    or org_id in (select org_id from organization_members where user_id = auth.uid())
  );

create policy "Admins can manage alert rules"
  on alert_rules for all
  to authenticated
  using (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid() and role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    org_id in (
      select org_id from organization_members
      where user_id = auth.uid() and role in ('owner', 'admin', 'editor')
    )
  );

-- ---------------------------------------------------------------------
-- notifications — in-app toast/bell items (separate from alerts which
-- are the raw threshold breach records; notifications are the user-facing
-- delivery channel)
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  alert_id uuid references alerts(id) on delete cascade,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;

-- Users can read/manage their own notifications.
create policy "Users can read their own notifications"
  on notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can update their own notifications"
  on notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- notification_preferences — per-user toggle for email/push/weekly report
-- (makes the Settings page toggles real, closes G13)
-- ---------------------------------------------------------------------
create table if not exists notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  email boolean not null default true,
  push boolean not null default true,
  weekly_report boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table notification_preferences enable row level security;

create policy "Users can read their own notification preferences"
  on notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can update their own notification preferences"
  on notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Enable Realtime on notifications so the bell icon updates live
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table notifications;

-- ---------------------------------------------------------------------
-- Seed a few default alert rules so the engine has something to evaluate
-- out of the box. These match the §5.0 POOR thresholds.
-- ---------------------------------------------------------------------
insert into alert_rules (org_id, node_id, metric, operator, threshold, severity, cooldown_minutes, enabled)
values
  (null, null, 'heat_index', 'gt', 29, 'critical', 30, true),
  (null, null, 'heat_index', 'lt', 18, 'critical', 30, true),
  (null, null, 'air_quality', 'gt', 60, 'warning', 60, true),
  (null, null, 'temperature', 'gt', 35, 'critical', 30, true),
  (null, null, 'humidity', 'gt', 80, 'warning', 60, true)
on conflict do nothing;
