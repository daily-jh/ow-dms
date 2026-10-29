-- OW-DMS 0002: 런타임 계정, 최소권한, 행 수준 보안(RLS)
-- 런타임 계정은 superuser/owner/BYPASSRLS가 아니다. 비밀번호는 개발용이며 운영에서는 별도 주입한다.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'owdms_app') then
    create role owdms_app login password 'owdms_app_dev' nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public to owdms_app;
grant execute on function app_tenant(), app_user() to owdms_app;

-- 기관 범위 업무 테이블: RLS 강제 + tenant_id = app_tenant()
do $$
declare
  t text;
begin
  foreach t in array array[
    'memberships', 'legal_entities', 'facilities', 'donors', 'donor_private', 'funds', 'money_receipts',
    'receipt_fund_lines', 'items', 'warehouses', 'goods_receipts', 'goods_receipt_lines', 'lots',
    'stock_ledger', 'stock_balances', 'distributions', 'distribution_lines', 'approvals', 'period_closures',
    'generated_documents', 'integration_batches', 'integration_rows', 'outbox', 'job_runs', 'idempotency_keys'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_self on tenants using (id = app_tenant());

alter table users enable row level security;
alter table users force row level security;
-- 같은 기관 구성원의 표시명만 조회 가능
create policy users_same_tenant on users using (
  id = app_user() or exists (select 1 from memberships m where m.user_id = users.id and m.tenant_id = app_tenant())
);

alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_insert on audit_events for insert with check (tenant_id is null or tenant_id = app_tenant());
create policy audit_select on audit_events for select using (tenant_id = app_tenant());

-- 최소 권한
grant select on tenants, users to owdms_app;
grant select on memberships, legal_entities, facilities to owdms_app;
grant select, insert, update on donors, donor_private, funds, items, warehouses to owdms_app;
grant select, insert, update, delete on money_receipts, receipt_fund_lines, goods_receipts, goods_receipt_lines,
  distributions, distribution_lines to owdms_app;
grant select, insert on lots to owdms_app;
grant select, insert on stock_ledger to owdms_app; -- UPDATE/DELETE 권한 없음(append-only)
grant select, insert, update on stock_balances to owdms_app;
grant select, insert, update on approvals, period_closures to owdms_app;
grant select, insert on generated_documents to owdms_app;
grant select, insert, update on integration_batches, integration_rows to owdms_app;
grant select, insert, update on outbox to owdms_app;
grant select, insert on job_runs to owdms_app;
grant select, insert on idempotency_keys to owdms_app;
grant select, insert on audit_events to owdms_app;

-- ───────────── 인증 전용 SECURITY DEFINER 함수 ─────────────
-- 로그인·요청 시 기관 컨텍스트가 정해지기 전 필요한 최소 정보만 반환한다.
create or replace function auth_find_user(p_username text)
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, display_name from users where username = p_username and disabled_at is null
$$;

create or replace function auth_memberships(p_user_id uuid)
returns table (tenant_id uuid, tenant_name text, roles text[], self_approval_exception boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.tenant_id, t.name, m.roles, m.self_approval_exception
  from memberships m
  join tenants t on t.id = m.tenant_id
  join users u on u.id = m.user_id
  where m.user_id = p_user_id
    and u.disabled_at is null
    and m.revoked_at is null
    and m.valid_from <= current_date
    and (m.valid_to is null or m.valid_to >= current_date)
$$;

-- worker: 처리할 이벤트가 있는 기관 목록만 반환(내용은 기관 컨텍스트에서 RLS로 읽는다)
create or replace function worker_pending_tenants()
returns table (tenant_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct tenant_id from outbox where processed_at is null and attempts < 10
$$;

revoke all on function auth_find_user(text), auth_memberships(uuid), worker_pending_tenants() from public;
grant execute on function auth_find_user(text), auth_memberships(uuid), worker_pending_tenants() to owdms_app;
