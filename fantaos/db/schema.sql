-- FantaOS Foundation v1
-- PostgreSQL schema: tenant isolation is mandatory for all private domain entities.

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  display_name text,
  plan text not null default 'FREE'
    check (plan in ('FREE','PRO','PRO_MULTI','COMMISSIONER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  platform text not null default 'manual',
  mode text not null check (mode in ('CLASSIC','MANTRA')),
  season text not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists league_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'MEMBER'
    check (role in ('OWNER','MEMBER','COMMISSIONER','VIEWER')),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists fantasy_teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  owner_user_id uuid references users(id) on delete set null,
  name text not null,
  credits numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rulesets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  league_id uuid not null unique references leagues(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  club text,
  role_classic text,
  roles_mantra text[] not null default '{}',
  external_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rosters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  fantasy_team_id uuid not null references fantasy_teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete restrict,
  acquisition_cost numeric(12,2),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','RELEASED')),
  acquired_at timestamptz,
  released_at timestamptz,
  unique (league_id, player_id)
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,
  fantasy_team_id uuid references fantasy_teams(id) on delete set null,
  decision_type text not null,
  model_version text not null,
  recommendation jsonb not null,
  alternatives jsonb not null default '[]'::jsonb,
  expected_value numeric,
  baseline_value numeric,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  frozen_at timestamptz
);

create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  decision_id uuid not null unique references decisions(id) on delete cascade,
  actual_result jsonb not null,
  realized_value numeric,
  baseline_result numeric,
  regret numeric,
  evaluated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  league_id uuid references leagues(id) on delete set null,
  request_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists users_tenant_idx on users(tenant_id);
create index if not exists leagues_tenant_idx on leagues(tenant_id);
create index if not exists teams_league_idx on fantasy_teams(tenant_id, league_id);
create index if not exists rosters_team_idx on rosters(tenant_id, fantasy_team_id);
create index if not exists decisions_league_idx on decisions(tenant_id, league_id, created_at desc);
create index if not exists audit_tenant_idx on audit_events(tenant_id, created_at desc);

-- Application-level tenant guards are required from day one.
-- Database-native RLS policies will be added when the managed Postgres provider
-- and authenticated session strategy are finalized.
