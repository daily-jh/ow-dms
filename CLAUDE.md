# CLAUDE.md — OW-DMS 작업 지침

복지기관 후원금·후원품 관리 시스템(OW-DMS). 명세: `docs/CLAUDE_CODE_HANDOFF.md`(v1.1). 구현 기준은 명세의 통합 본문이며, 미확인 사항은 `docs/VALIDATION_REGISTER.md`에서 관리한다.

## 명령
- 설치: `pnpm install` (Node ≥22, 권장 24 LTS, pnpm 10)
- DB(개발): `docker compose -f infra/compose.yaml up -d` 또는 로컬 PostgreSQL. `ALLOW_DB_RESET=true pnpm db:reset`
- 실행: `pnpm dev:api` / `pnpm dev:worker` / `pnpm dev:web` (환경값은 `.env.example` 참고)
- 검사: `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration`(실제 PostgreSQL 필요) → `pnpm --filter @owdms/web build`
- 브라우저 점검: 서버 3종 실행 후 `node tests/browser/smoke.mjs`

## 절대 규칙
- 실제 기관 개인정보·증빙·인증서·비밀번호·계좌정보를 저장소, 로그, 프롬프트에 넣지 않는다. 시험은 합성자료만 사용한다.
- 승인된 거래는 직접 UPDATE/DELETE하지 않는다(정정·역거래). `stock_ledger`, `audit_events`는 append-only.
- 금액은 원 단위 `bigint`, 수량은 `numeric(18,3)`/고정소수 bigint. JS number로 금액·재고를 계산하지 않는다.
- 음수재고 금지, 약정을 수입으로 처리 금지, 후원자 자동 병합 금지, 임의 가액 영수증 금지.
- 기관 격리: 모든 업무 쿼리는 `withTenant()` 안에서 실행한다. 앱 런타임 계정(`owdms_app`)은 superuser/owner/BYPASSRLS가 아니다. 새 업무 테이블에는 `tenant_id`, `(tenant_id, id)` 복합 FK, RLS(FORCE) 정책을 반드시 추가한다.
- 권한은 화면 숨김이 아니라 서비스(`requireAction`)·RLS에서 검증한다.
- 희망이음: 공식 원본·규격 확보 전에는 reference 모드만. 파일명·문구에 "희망이음 업로드 파일"이라고 쓰지 않는다. `submit`은 비활성. EXPORTED(다운로드)·SUBMITTED·ACKNOWLEDGED·VERIFIED를 섞지 않는다.
- 법정 서식·세무 판단·기관 전용 절차를 만들어내지 않는다. 공통 예시는 "기관 검토 필요"로 표기한다.

## 구조
`packages/domain`(순수 규칙) → `packages/db`(migration·RLS·트랜잭션 서비스) → `apps/api`(NestJS HTTP) / `apps/worker`(outbox) → `apps/web`(Next.js, API만 호출).
migration은 추가만 한다(적용된 파일 수정 시 migrate가 중단됨).

## 변경 시 확인
새 기능은 단위시험 + 실제 PostgreSQL 통합시험(기관 격리·권한 거부 경로 포함)을 함께 추가하고, 실행 결과를 `docs/VERIFICATION_LOG.md`에 기록한다.
