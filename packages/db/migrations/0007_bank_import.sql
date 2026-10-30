-- 통장 거래내역·후원금 양식 파일 반입과 입금 대조.
-- 반입한 입금은 '후보'일 뿐 수입이 아니다. 담당자가 후원자·기금을 골라 후원금 초안을 만들고, 승인을 거쳐야 수입이 된다.
-- 원본 파일은 저장하지 않고(개인정보 최소화) 해시와 해석 결과만 남긴다.

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  kind text not null check (kind in ('BANK_STATEMENT', 'MONEY_SHEET')),
  account_label text, -- 통장 구분 이름(예: 후원금 통장). 계좌번호는 넣지 않는다.
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  total_rows integer not null check (total_rows >= 0),
  imported_rows integer not null check (imported_rows >= 0),
  duplicate_rows integer not null check (duplicate_rows >= 0),
  skipped_rows integer not null check (skipped_rows >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  unique (tenant_id, id),
  check ((kind = 'BANK_STATEMENT') = (account_label is not null))
);
-- 후원금 양식은 같은 파일을 두 번 넣으면 초안이 두 벌 생기므로 막는다. 통장 내역은 거래 지문으로 중복을 거른다.
create unique index import_batches_money_sheet_once on import_batches (tenant_id, file_sha256) where kind = 'MONEY_SHEET';

create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  batch_id uuid not null,
  account_label text not null,
  occurred_on date not null,
  occurred_time time,
  amount bigint not null check (amount > 0), -- 입금액(원)
  balance bigint,
  counterparty text not null default '', -- 통장에 찍힌 입금자명·기재내용
  memo text,
  fingerprint text not null,
  line_no integer not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'EXCLUDED')),
  exclude_reason text,
  excluded_by uuid references users(id),
  excluded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, account_label, fingerprint),
  foreign key (tenant_id, batch_id) references import_batches(tenant_id, id),
  check ((status = 'EXCLUDED') = (exclude_reason is not null))
);
create index bank_transactions_open on bank_transactions (tenant_id, status, occurred_on);

-- 입금 1건 → 후원금 수입 여러 건(분할) 연결. 합계가 입금액을 넘지 않는지는 서비스가 행 잠금 후 검사한다.
create table bank_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  bank_transaction_id uuid not null,
  money_receipt_id uuid not null,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  unique (tenant_id, id),
  unique (tenant_id, money_receipt_id),
  foreign key (tenant_id, bank_transaction_id) references bank_transactions(tenant_id, id),
  foreign key (tenant_id, money_receipt_id) references money_receipts(tenant_id, id)
);
create index bank_allocations_tx on bank_allocations (tenant_id, bank_transaction_id);

create trigger import_batches_append_only before update or delete on import_batches
  for each row execute function forbid_change();
create trigger bank_allocations_append_only before update or delete on bank_allocations
  for each row execute function forbid_change();

do $$
declare t text;
begin
  foreach t in array array['import_batches', 'bank_transactions', 'bank_allocations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = app_tenant()) with check (tenant_id = app_tenant())', t);
  end loop;
end $$;

grant select, insert on import_batches, bank_transactions, bank_allocations to owdms_app;
-- 반입한 거래 자체(일자·금액·입금자)는 고치지 못하고 '후원금 아님' 표시만 바꾼다.
grant update (status, exclude_reason, excluded_by, excluded_at) on bank_transactions to owdms_app;
