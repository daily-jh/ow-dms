-- 기관 초기 설정용 업무 분류표(후원 관리유형·후원사업·협력처·업무일정)와 프리셋 적용 기록.
-- 모두 비개인 메타데이터이다. 후원자·수혜자·거래·계좌를 만들지 않으며, 사업은 기금(회계 구분)이 아니다.

create table donation_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('MANAGEMENT_TYPE', 'PROGRAM', 'PARTNER', 'SCHEDULE')),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text not null check (length(name) between 1 and 80),
  category text, -- 사업 분류(결연·모금함 등) 또는 협력처 구분(어린이집·비치처·외부기관)
  detail text check (length(detail) <= 300),
  source_pages text check (length(source_pages) <= 40),
  preset_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  unique (tenant_id, id),
  unique (tenant_id, kind, code)
);
create index donation_catalog_kind on donation_catalog (tenant_id, kind, active);

-- 프리셋을 언제 누가 어떤 선택으로 적용했는지. 추가만 한다.
create table master_preset_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  preset_code text not null,
  preset_version text not null,
  facility_id uuid not null,
  selection jsonb not null,
  created_count integer not null check (created_count >= 0),
  reused_count integer not null check (reused_count >= 0),
  applied_at timestamptz not null default now(),
  applied_by uuid not null references users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id)
);

create trigger master_preset_applications_append_only before update or delete on master_preset_applications
  for each row execute function forbid_change();

do $$
declare t text;
begin
  foreach t in array array['donation_catalog', 'master_preset_applications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;

grant select, insert on donation_catalog, master_preset_applications to owdms_app;
-- 분류표는 코드·종류를 바꾸지 않는다. 이름·설명·사용 여부만 고친다.
grant update (name, detail, active) on donation_catalog to owdms_app;
