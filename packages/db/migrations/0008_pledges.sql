-- 정기후원 약정. 약정은 수입이 아니며 '매달 얼마를 내기로 했다'는 예정만 기록한다.
-- 실제 수입은 후원금 수입(money_receipts)이 승인될 때만 생기고, 그 수입이 어느 약정의 몇 월분인지 연결한다.

create table pledges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  donor_id uuid not null,
  fund_id uuid not null,
  facility_id uuid not null,
  amount bigint not null check (amount > 0), -- 월 약정액(원)
  frequency text not null default 'MONTHLY' check (frequency in ('MONTHLY')),
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (extract(day from end_month) = 1),
  method text not null check (method in ('BANK_TRANSFER', 'CMS', 'CARD', 'OTHER')),
  memo text,
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  ended_at timestamptz,
  ended_by uuid references users(id),
  end_reason text,
  unique (tenant_id, id),
  foreign key (tenant_id, donor_id) references donors(tenant_id, id),
  foreign key (tenant_id, fund_id) references funds(tenant_id, id),
  foreign key (tenant_id, facility_id) references facilities(tenant_id, id),
  check (end_month is null or end_month >= start_month),
  check ((ended_at is null) = (end_reason is null))
);
create index pledges_donor on pledges (tenant_id, donor_id);

alter table pledges enable row level security;
alter table pledges force row level security;
create policy tenant_isolation on pledges using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

grant select, insert on pledges to owdms_app;
-- 약정 내용(후원자·금액·시작월)은 고치지 않는다. 끝내기(종료월·사유)만 기록한다. 금액이 바뀌면 끝내고 새로 등록한다.
grant update (end_month, ended_at, ended_by, end_reason) on pledges to owdms_app;

-- 후원금 수입 → 약정의 몇 월분인지. 둘 다 있거나 둘 다 없다.
alter table money_receipts add column pledge_id uuid;
alter table money_receipts add column pledge_month date;
alter table money_receipts add constraint money_receipts_pledge_fk
  foreign key (tenant_id, pledge_id) references pledges(tenant_id, id);
alter table money_receipts add constraint money_receipts_pledge_pair
  check ((pledge_id is null) = (pledge_month is null) and (pledge_month is null or extract(day from pledge_month) = 1));
create index money_receipts_pledge on money_receipts (tenant_id, pledge_id, pledge_month) where pledge_id is not null;
