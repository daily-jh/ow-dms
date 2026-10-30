-- 기준정보(법인·시설·창고·품목·기금) 관리: 기관관리자가 화면에서 입력한다.
-- 이미 거래에 쓰인 기준정보는 지우지 않고 '사용 중지'로 숨긴다(과거 기록 보존).

alter table legal_entities add column active boolean not null default true;
alter table facilities add column active boolean not null default true;
alter table warehouses add column active boolean not null default true;
alter table items add column active boolean not null default true;
alter table funds add column active boolean not null default true;

-- 같은 기관 안에서 이름 중복 방지(대소문자·앞뒤 공백 무시). 동명이인이 있을 수 있는 후원자와 달리 기준정보는 이름으로 고른다.
create unique index legal_entities_name on legal_entities (tenant_id, lower(btrim(name)));
create unique index facilities_name on facilities (tenant_id, lower(btrim(name)));
create unique index warehouses_name on warehouses (tenant_id, facility_id, lower(btrim(name)));
create unique index items_name on items (tenant_id, lower(btrim(name)));
create unique index funds_name on funds (tenant_id, lower(btrim(name)));

grant insert, update on legal_entities, facilities to owdms_app;
