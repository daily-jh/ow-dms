-- 업무정리용 항목. 모금 경로는 지정/비지정 기금 및 수납방법과 별개이다.
alter table money_receipts
  add column source_channel text not null default 'OTHER'
    check (source_channel in ('DIRECT','REGULAR','SPONSORSHIP','HAPPYBEAN','PIGGY_BANK','COLLECTION_BOX','CORPORATION','BAZAAR','EXTERNAL_GRANT','OTHER')),
  add column project_name text check (length(project_name) <= 100),
  add column evidence_ref text check (length(evidence_ref) <= 100);
