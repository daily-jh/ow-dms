# 데이터 사전

공통: UUID `id`, `tenant_id`(RLS 기준), 업무일자 `DATE`, 시각 `timestamptz`(UTC 저장·KST 표시), 금액 `bigint`(원), 수량 `numeric(18,3)`. API에서는 금액·수량을 문자열로 주고받는다.

| 테이블 | 주요 컬럼 | 규칙 |
|---|---|---|
| tenants | code, name | 기관 |
| users | username, display_name, disabled_at | 전역. 같은 기관 구성원만 조회(RLS) |
| memberships | tenant_id, user_id, roles[], self_approval_exception, valid_from/to, revoked_at | 매 요청 재확인 |
| legal_entities / facilities | kind(CORPORATION/FACILITY), legal_entity_id | 소속법인과 시설 분리 |
| donors | donor_type, display_name, external_ref, version | 동명이인 허용(UNIQUE 없음), 자동 병합 금지 |
| donor_private | contact_ciphertext(AES-256-GCM), key_version | 키는 DB 밖. 권한자에게 마스킹 표시 |
| funds | designated, purpose | 지정/비지정 |
| money_receipts | received_on, amount>0, method, status, version, snapshot_hash | 약정과 분리. 승인 후 불변 |
| receipt_fund_lines | fund_id, amount>0 | 합계=수납액(서비스 검증) |
| items / warehouses | base_unit, perishable / facility_id | |
| goods_receipts | donor_id, received_on, status, version, snapshot_hash | 승인 후 불변 |
| goods_receipt_lines | quantity, unit, unit_conversion(jsonb 스냅샷), expires_on, valuation_status, unit_value, total_value, valuation_basis | 가액 미확정(NULL)과 0원 구분 |
| lots | receipt_line_id(1:1), lot_code, unit, expires_on | 승인 시 생성 |
| stock_ledger | movement_type, quantity_delta(≠0), ref_type/ref_id, reverses_id | append-only, 진실의 원천 |
| stock_balances | on_hand≥0, reserved≥0, reserved≤on_hand | 원장으로 재구축 가능(`verifyStockLedger`) |
| distributions / distribution_lines | program_name, recipient_ref(제한 ID), planned_on, status / lot_id, warehouse_id, quantity | 승인=예약, 출고=원장 차감 |
| approvals | target_type/id/version, snapshot(jsonb), snapshot_hash, status, requested_by, decided_by | 대상별 대기 1건(부분 UNIQUE) |
| period_closures | period(YYYY-MM), reopened_* | 마감 기간 초안·승인·출고 차단 |
| generated_documents | document_type, template_id/version, source_*, is_draft, snapshot, snapshot_hash, output_hash, generated_by_job | 재출력 시 해시 일치 확인 |
| integration_batches / integration_rows | mode, spec_version, idempotency_key / state, source_version, source_snapshot_hash, external_ref, verified_* | 행별 상태 |
| outbox / job_runs | event_type, aggregate_*, processed_at, attempts / event_id UNIQUE | 중복 소비 차단 |
| idempotency_keys | key, request_hash, status_code, response | (tenant,key) PK |
| audit_events | category(LEDGER/ACCESS/AUTH/ADMIN), action, resource_type/id, result, request_id | 원문 개인정보 금지, append-only |

상태값: 거래 `DRAFT → PENDING_APPROVAL → APPROVED (→ REVERSED)`, 반려 `REJECTED`(수정 후 재요청). 배분은 `APPROVED → POSTED`. 외부연계 `NOT_READY → VALIDATED → PREPARED → EXPORTED → SUBMITTED → ACKNOWLEDGED → VERIFIED | REJECTED | UNKNOWN`.
