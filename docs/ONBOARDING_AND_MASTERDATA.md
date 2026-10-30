# 기관 설정·기준정보 자동 초기입력

2026-10-30 · 근거: 연무복지관 자동 초기입력·기준정보·후원사업 구조개편 문서 v2의 P0-A

## 무엇을 하나

| 기능 | 위치 | 권한 |
|---|---|---|
| 업무 준비 상태(법인·시설·기금·후원담당·창고·품목, 분류 수, 마지막 적용) | 오늘의 업무 카드, `/setup`, `GET /v1/onboarding/readiness` | settings.write·money.read·goods.read 중 하나 |
| 연무 기본 항목 미리보기(항목별 상태) | `/setup`, `GET /v1/onboarding/presets/yeonmu` | settings.write, 기관 코드 `yeonmu`만 |
| 한 번에 적용 | `/setup`, `POST /v1/settings/presets/yeonmu` | settings.write, 기관 코드 `yeonmu`만 |
| 업무 분류 목록·이름·사용 여부 변경 | `/settings`, `GET /v1/settings/catalog`, `POST /v1/settings/catalog/:id` | 조회는 위 세 권한(담당자는 사용 중인 것만), 변경은 settings.write |

후원금 화면은 시설·기금이 없으면 저장폼 대신 안내를 보이고, 관리자에게는 **기관 설정하기**로 이어진다.

## 항목 상태

- 추가 후보(MISSING): 아직 없음. 기본값이면 미리 체크.
- 사용 중(ACTIVE): 이미 있음. 다시 적용해도 그대로 재사용.
- 사용 중지됨(INACTIVE): 자동으로 다시 켜지 않는다.
- 조건 다름(CONFLICT): 같은 이름의 기금이 지정 여부·목적이 다르다. 덮어쓰지 않고 적용을 거부한다.

## 연무 기본 항목(v2)

기금 2(비지정후원금, 결연후원금), 후원 관리유형 7(법인결연은 기본 해제), 후원사업 14(운영법인 후원은 기본 해제), 협력처 25(어린이집 8·모금함 비치처 10은 기본 해제, 외부기관 7), 업무일정 12. 원본은 `packages/domain/src/institutionPreset.ts`.

- 관리유형·사업은 **회계 기금이 아닌 분류**다. 사업코드는 개발 제안값이다.
- 협력처는 이름만 둔다. 주소·연락처·담당자·실적은 넣지 않는다. 모금함 비치처는 기부자가 아니다.
- 업무일정은 기관 내부 관행 예시이며 법정 기한이 아니다(기관 검토 필요).
- 품목 예시는 표시만 하고 자동으로 만들지 않는다(단위·가액 미정).

## 적용 규칙

1. 소속 법인·시설은 기존 것을 고르거나 관리자가 정확한 명칭을 직접 입력한다. 둘 중 하나만 허용한다.
2. 모든 추가는 한 트랜잭션에서 하고, 하나라도 충돌하면 전부 되돌린다. 기관별 advisory lock으로 동시 적용을 막는다.
3. 분류는 `(tenant_id, kind, code)` 고유키로 중복을 막고, 이미 있으면 이름·사용 여부를 바꾸지 않는다.
4. 적용마다 `master_preset_applications`(추가만, 수정·삭제 트리거 차단)에 버전·선택·생성/재사용 수를 남기고 감사기록 `master.preset.apply`를 쓴다.
5. 후원자·수혜자·계좌·거래·약정·재고는 만들지 않는다.

## DB

migration `0010_onboarding_catalog.sql`: `donation_catalog`(MANAGEMENT_TYPE·PROGRAM·PARTNER·SCHEDULE), `master_preset_applications`. 둘 다 `tenant_id`, `(tenant_id, id)` 고유키, RLS FORCE. 앱 계정은 분류표의 name·detail·active만 수정할 수 있다.

## 다음 단계(P0-B, 미구현)

결연 다대다(후원자↔대상자↔사업), 월별 배분·지급확인, 약정·수입의 사업 연결. 실제 지급·송금 기능은 만들지 않는다.
