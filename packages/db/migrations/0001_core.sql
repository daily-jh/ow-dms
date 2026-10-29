-- OW-DMS 0001: 기관 격리·원장·승인·재고·문서·연계·감사 기반
-- 원칙: 승인된 거래는 직접 수정/삭제 금지, 교차기관 참조는 (tenant_id, id) 복합 FK로 차단,
--       앱 런타임 계정은 owner/superuser/BYPASSRLS가 아니며 모든 업무 테이블에 RLS(FORCE) 적용.

create extension if not exists pgcrypto;

-- 트랜잭션 범위 컨텍스트(set_config(..., true))에서만 값을 읽는다.
create or replace function app_tenant() returns uuid
language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create or replace function app_user() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ───────────── 기관·사용자 ─────────────
create table tenants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  roles text[] not null check (cardinality(roles) > 0),
  -- 소규모 기관 겸직(자기승인) 예외는 기관 승인된 정책으로만 켠다.
  self_approval_exception boolean not null default false,
  valid_from date not null default current_date,
  valid_to date,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table legal_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  kind text not null check (kind in ('CORPORATION', 'FACILITY')),
  unique (tenant_id, id)
);

create table facilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  legal_entity_id uuid not null,
  name text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, legal_entity_id) references legal_entities(tenant_id, id)
);

-- ───────────── 후원자 ─────────────
create table donors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid,
  donor_type text not null check (donor_type in ('INDIVIDUAL', 'CORPORATION', 'GROUP', 'ANONYMOUS')),
  display_name text not null, -- 동명이인 허용: UNIQUE 금지
  external_ref text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  version integer not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id)
);
create index donors_name_idx on donors (tenant_id, display_name);

-- 연락처는 애플리케이션 암호화(AES-256-GCM) 후 저장. 키는 DB에 두지 않는다.
create table donor_private (
  donor_id uuid primary key,
  tenant_id uuid not null,
  contact_ciphertext bytea not null,
  key_version integer not null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, donor_id) references donors(tenant_id, id)
);

-- ───────────── 기금·후원금 ─────────────
create table funds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  designated boolean not null,
  purpose text,
  unique (tenant_id, id)
);

create table money_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null,
  donor_id uuid, -- 익명·미확인 입금 허용
  received_on date not null,
  amount bigint not null check (amount > 0),
  method text not null check (method in ('BANK_TRANSFER', 'CASH', 'CMS', 'CARD', 'OTHER')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED')),
  memo text,
  version integer not null default 1,
  snapshot_hash text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  approved_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id),
  foreign key (tenant_id, donor_id) references donors(tenant_id, id)
);

create table receipt_fund_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,
  fund_id uuid not null,
  amount bigint not null check (amount > 0),
  foreign key (tenant_id, receipt_id) references money_receipts(tenant_id, id),
  foreign key (tenant_id, fund_id) references funds(tenant_id, id)
);

-- ───────────── 후원품·재고 ─────────────
create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  base_unit text not null,
  perishable boolean not null default false,
  unique (tenant_id, id)
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null,
  name text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id)
);

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null,
  donor_id uuid,
  received_on date not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED')),
  memo text,
  version integer not null default 1,
  snapshot_hash text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  approved_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id),
  foreign key (tenant_id, donor_id) references donors(tenant_id, id)
);

create table goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,
  line_no integer not null,
  item_id uuid not null,
  warehouse_id uuid not null,
  quantity numeric(18, 3) not null check (quantity > 0),
  unit text not null,
  -- 거래 당시 환산 스냅샷(예: {"unit":"상자","baseUnit":"개","factor":"20"})
  unit_conversion jsonb,
  expires_on date,
  -- 가액 미확정(NULL)과 확정 0원은 다르다.
  valuation_status text not null default 'UNCONFIRMED' check (valuation_status in ('UNCONFIRMED', 'PROPOSED', 'CONFIRMED')),
  unit_value bigint check (unit_value >= 0),
  total_value bigint check (total_value >= 0),
  valuation_basis text,
  unique (tenant_id, id),
  unique (receipt_id, line_no),
  foreign key (tenant_id, receipt_id) references goods_receipts(tenant_id, id),
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);

create table lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null,
  receipt_line_id uuid not null unique,
  lot_code text not null,
  unit text not null,
  received_on date not null,
  expires_on date,
  unique (tenant_id, id),
  unique (tenant_id, lot_code),
  foreign key (tenant_id, item_id) references items(tenant_id, id),
  foreign key (tenant_id, receipt_line_id) references goods_receipt_lines(tenant_id, id)
);

-- 원장이 진실: INSERT만 허용(앱 계정 UPDATE/DELETE 권한 없음 + 트리거)
create table stock_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  lot_id uuid not null,
  warehouse_id uuid not null,
  movement_type text not null check (movement_type in (
    'RECEIPT', 'DISTRIBUTION', 'DISPOSAL', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DONOR_RETURN',
    'DISTRIBUTION_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL_IN', 'REVERSAL_OUT')),
  quantity_delta numeric(18, 3) not null check (quantity_delta <> 0),
  ref_type text not null,
  ref_id uuid not null,
  reverses_id bigint references stock_ledger(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  foreign key (tenant_id, lot_id) references lots(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);
create index stock_ledger_lot_idx on stock_ledger (tenant_id, lot_id, warehouse_id);

-- 원장에서 재구축 가능한 잔고. 음수 재고·예약 초과는 DB 제약으로도 차단.
create table stock_balances (
  tenant_id uuid not null,
  lot_id uuid not null,
  warehouse_id uuid not null,
  on_hand numeric(18, 3) not null check (on_hand >= 0),
  reserved numeric(18, 3) not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, lot_id, warehouse_id),
  check (reserved <= on_hand),
  foreign key (tenant_id, lot_id) references lots(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);

create table distributions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  facility_id uuid not null,
  program_name text not null,
  -- 수혜자는 제한된 대상자 ID로만 참조(사례관리 본문 수집 금지)
  recipient_ref text,
  planned_on date not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED')),
  delivery_confirmed_at timestamptz,
  version integer not null default 1,
  snapshot_hash text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  approved_at timestamptz,
  posted_at timestamptz,
  posted_by uuid references users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id)
);

create table distribution_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  distribution_id uuid not null,
  line_no integer not null,
  lot_id uuid not null,
  warehouse_id uuid not null,
  quantity numeric(18, 3) not null check (quantity > 0),
  unique (distribution_id, line_no),
  foreign key (tenant_id, distribution_id) references distributions(tenant_id, id),
  foreign key (tenant_id, lot_id) references lots(tenant_id, id),
  foreign key (tenant_id, warehouse_id) references warehouses(tenant_id, id)
);

-- ───────────── 승인·마감 ─────────────
create table approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_type text not null check (target_type in ('GOODS_RECEIPT', 'MONEY_RECEIPT', 'DISTRIBUTION')),
  target_id uuid not null,
  target_version integer not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED')),
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references users(id),
  decided_at timestamptz,
  reason text,
  unique (tenant_id, id)
);
create unique index approvals_one_pending on approvals (tenant_id, target_type, target_id) where status = 'PENDING';

create table period_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  period char(7) not null check (period ~ '^\d{4}-\d{2}$'),
  closed_at timestamptz not null default now(),
  closed_by uuid not null references users(id),
  reopened_at timestamptz,
  reopened_by uuid references users(id),
  reopen_reason text
);
create unique index period_closures_active on period_closures (tenant_id, period) where reopened_at is null;

-- ───────────── 문서 ─────────────
create table generated_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  document_type text not null,
  template_id text not null,
  template_version text not null,
  source_type text not null,
  source_id uuid not null,
  source_version integer not null,
  is_draft boolean not null,
  snapshot jsonb not null,
  snapshot_hash text not null,
  output_hash text not null,
  disclosure_level text not null default 'INTERNAL' check (disclosure_level in ('INTERNAL', 'SUBMISSION', 'PUBLIC')),
  generated_by uuid references users(id), -- worker 자동생성은 NULL + generated_by_job
  generated_by_job text,
  generated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index generated_documents_auto_once
  on generated_documents (tenant_id, document_type, source_type, source_id, source_version)
  where generated_by_job is not null;

-- ───────────── 외부연계(희망이음 등) ─────────────
create table integration_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  target_system text not null,
  operation text not null,
  mode text not null check (mode in ('reference', 'officialFile', 'approvedModule', 'officialApi')),
  spec_version text,
  idempotency_key text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key)
);

create table integration_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id uuid not null,
  source_type text not null,
  source_id uuid not null,
  source_version integer not null,
  source_snapshot_hash text not null,
  state text not null check (state in ('NOT_READY', 'VALIDATED', 'PREPARED', 'EXPORTED', 'SUBMITTED',
    'ACKNOWLEDGED', 'VERIFIED', 'REJECTED', 'UNKNOWN', 'CORRECTION_REQUIRED')),
  external_ref text,
  verified_by uuid references users(id),
  verified_at timestamptz,
  evidence_id text,
  issues jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references integration_batches(tenant_id, id)
);

-- ───────────── outbox·멱등·감사 ─────────────
create table outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  unique (tenant_id, event_type, aggregate_id, aggregate_version)
);
create index outbox_pending on outbox (created_at) where processed_at is null;

create table job_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  event_id uuid not null unique references outbox(id), -- 중복 소비 차단
  handler text not null,
  finished_at timestamptz not null default now()
);

create table idempotency_keys (
  tenant_id uuid not null references tenants(id),
  key text not null,
  user_id uuid not null references users(id),
  request_hash text not null,
  status_code integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- 개인정보 원문 payload 금지: 대상은 ID로만 기록
create table audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants(id),
  actor_user_id uuid references users(id),
  category text not null check (category in ('LEDGER', 'ACCESS', 'AUTH', 'ADMIN')),
  action text not null,
  resource_type text,
  resource_id text,
  result text not null check (result in ('SUCCESS', 'DENIED', 'FAILED')),
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);

-- ───────────── 불변 원장 트리거 ─────────────
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'APPEND_ONLY: % is append-only', tg_table_name using errcode = 'P0001';
end $$;

create trigger stock_ledger_append_only before update or delete on stock_ledger
  for each row execute function forbid_change();
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function forbid_change();

-- 승인된 헤더는 상태 이동(예: 게시·역거래) 외의 직접 수정 금지
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
  if old.status in ('APPROVED', 'POSTED', 'REVERSED')
     and (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored) then
    raise exception 'APPROVED_IMMUTABLE: approved % cannot be edited; use a correction', tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger money_receipts_guard before update or delete on money_receipts
  for each row execute function guard_approved_header();
create trigger goods_receipts_guard before update or delete on goods_receipts
  for each row execute function guard_approved_header();
create trigger distributions_guard before update or delete on distributions
  for each row execute function guard_approved_header();

-- 상세행은 상위 헤더가 초안/반려일 때만 변경 가능
create or replace function guard_lines() returns trigger language plpgsql as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  parent_status text;
begin
  parent_status := case tg_table_name
    when 'receipt_fund_lines' then (select status from money_receipts where id = (rec->>'receipt_id')::uuid)
    when 'goods_receipt_lines' then (select status from goods_receipts where id = (rec->>'receipt_id')::uuid)
    else (select status from distributions where id = (rec->>'distribution_id')::uuid) end;
  if parent_status not in ('DRAFT', 'REJECTED') then
    raise exception 'APPROVED_IMMUTABLE: lines of a submitted transaction cannot change' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger receipt_fund_lines_guard before insert or update or delete on receipt_fund_lines
  for each row execute function guard_lines();
create trigger goods_receipt_lines_guard before insert or update or delete on goods_receipt_lines
  for each row execute function guard_lines();
create trigger distribution_lines_guard before insert or update or delete on distribution_lines
  for each row execute function guard_lines();
