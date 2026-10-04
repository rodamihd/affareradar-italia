-- FantaOS tenant isolation policies
-- Apply after db/schema.sql once PostgreSQL is provisioned.

alter table users enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table fantasy_teams enable row level security;
alter table rulesets enable row level security;
alter table rosters enable row level security;
alter table decisions enable row level security;
alter table outcomes enable row level security;
alter table audit_events enable row level security;

create or replace function fantaos_current_tenant()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create policy users_tenant_isolation on users
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy leagues_tenant_isolation on leagues
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy league_members_tenant_isolation on league_members
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy fantasy_teams_tenant_isolation on fantasy_teams
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy rulesets_tenant_isolation on rulesets
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy rosters_tenant_isolation on rosters
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy decisions_tenant_isolation on decisions
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy outcomes_tenant_isolation on outcomes
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());

create policy audit_events_tenant_isolation on audit_events
  using (tenant_id = fantaos_current_tenant())
  with check (tenant_id = fantaos_current_tenant());
