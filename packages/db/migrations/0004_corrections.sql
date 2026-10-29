-- OW-DMS 0004: 승인 후 정정(역거래·취소·반품)과 마감 보강
-- 승인된 원거래는 수정하지 않고, 정정 요청 → 별도 승인 → 역거래로 반영한다.

create table correction_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_type text not null check (target_type in ('GOODS_RECEIPT', 'MONEY_RECEIPT', 'DISTRIBUTION')),
  target_id uuid not null,
  target_version integer not null,
  target_snapshot_hash text,
  kind text not null check (kind in ('REVERSAL', 'CANCEL', 'RETURN')),
  business_date date not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  version integer not null default 1,
  inspection_confirmed boolean not null default false,
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (tenant_id, id)
);
create unique index correction_events_one_open on correction_events (tenant_id, target_type, target_id) where status = 'PENDING_APPROVAL';

alter table correction_events enable row level security;
alter table correction_events force row level security;
create policy tenant_isolation on correction_events using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update on correction_events to owdms_app;

-- 승인 대상에 정정 요청 추가
alter table approvals drop constraint approvals_target_type_check;
alter table approvals add constraint approvals_target_type_check
  check (target_type in ('GOODS_RECEIPT', 'MONEY_RECEIPT', 'DISTRIBUTION', 'CORRECTION'));

-- 출고된 배분의 반품(회수확인 후) 상태
alter table distributions drop constraint distributions_status_check;
alter table distributions add constraint distributions_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'RETURNED'));

-- 승인 이후 상태(취소·반품 포함)에서도 직접 수정 금지
create or replace function guard_approved_header() returns trigger language plpgsql as $$
declare
  ignored text[] := array['status', 'posted_at', 'posted_by', 'delivery_confirmed_at'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'APPROVED_IMMUTABLE: only drafts can be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status in ('APPROVED', 'POSTED', 'REVERSED', 'CANCELLED', 'RETURNED')
     and (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    raise exception 'APPROVED_IMMUTABLE: approved % cannot be edited; use a correction', tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- 감사 조회 성능
create index audit_events_tenant_time on audit_events (tenant_id, created_at desc);
