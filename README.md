# OW-DMS · 복지기관 후원금·후원품 관리 시스템

사회복지시설 후원·회계 담당자를 위한 오픈소스 업무 시스템입니다. 후원 사실을 **한 번 입력**하면 승인된 같은 원장에서 재고·문서·대조자료·연계 준비자료가 만들어집니다.

> **개발판입니다.** 모든 자료는 합성(가상) 자료이며, 실제 기관·후원자 정보를 넣지 마십시오. 희망이음 공식 연계, 기부금영수증 발급, 기관 공식 서식은 아직 검증되지 않아 비활성 또는 "공통 예시"로 표시됩니다. 자세한 상태는 [`docs/VALIDATION_REGISTER.md`](docs/VALIDATION_REGISTER.md)를 보십시오.

## 지금 되는 것 (Phase 1)
- 기관(A/B) 격리: PostgreSQL 행 수준 보안(RLS)과 복합 외래키로 다른 기관 자료 접근 차단
- 후원자(동명이인 허용·자동 병합 없음, 연락처 암호화·마스킹), 후원금 초안(기금배분 합계 검증)
- 후원품 수입 → 승인 → 로트·재고원장 생성 → 배분(예약) → 출고 반영, 동시 출고 시 음수재고 차단
- 승인함: 요청 당시 스냅샷 승인, 자기승인 금지, 승인 후 직접 수정 불가
- 문서: 후원품 인수증·배분명부·후원금 수입확인(공통 예시, 초안 표시, 당시 문서 재출력)
- 희망이음 준비: 업무별 지원상태, **내부 검토용·희망이음 호환 미검증** Excel, 전송 비활성
- 오늘의 업무 대시보드, 감사기록, 멱등 요청(Idempotency-Key)

## 빠른 시작
요구: Node.js 22 이상(24 LTS 권장), pnpm 10, PostgreSQL 16+

```bash
pnpm install
docker compose -f infra/compose.yaml up -d          # 또는 로컬 PostgreSQL
export MIGRATION_DATABASE_URL=postgres://postgres:postgres-dev-only@localhost:5432/owdms
export DATABASE_URL=postgres://owdms_app:owdms_app_dev@localhost:5432/owdms
ALLOW_DB_RESET=true pnpm db:reset                   # migration + 합성 seed

export SESSION_SECRET='dev-only-secret-at-least-32-characters!!' DEV_LOGIN_ENABLED=true
pnpm dev:api      # :4000
pnpm dev:worker
pnpm dev:web      # :3000 → 합성 계정(a.goods, a.approver …)으로 로그인
```

시험 계정 흐름: `a.goods`로 후원품 입력·승인요청 → `a.approver`로 승인 → `a.goods`로 재고 확인·인수증 미리보기 → `b.goods`로 로그인하면 A기관 자료가 보이지 않습니다.

## 검사
```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration      # 실제 PostgreSQL에 owdms_test DB를 새로 만듭니다
pnpm --filter @owdms/web build
node tests/browser/smoke.mjs   # 서버 실행 중일 때 (Playwright)
```
최근 결과는 [`docs/VERIFICATION_LOG.md`](docs/VERIFICATION_LOG.md)에 있습니다.

## 구조
| 경로 | 내용 |
|---|---|
| `apps/web` | 업무 화면(Next.js) |
| `apps/api` | HTTP API(NestJS) |
| `apps/worker` | outbox 처리(승인 시 문서 자동생성) |
| `packages/domain` | 순수 업무 규칙 |
| `packages/db` | SQL migration·RLS·트랜잭션 서비스·합성 seed |
| `packages/documents` | 공통 예시 서식 |
| `packages/adapters` | 희망이음 reference 어댑터 |
| `docs/` | 명세·계획·출처/검증대장·아키텍처·데이터사전·권한·결정·검증기록 |

## 운영 전 반드시 필요한 것
OIDC 로그인, 운영 키관리(KMS), 백업·복원 시험, 기관 서식 원본 대조, 개인정보 처리근거 검토, 기관 병행운영 검증. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) 참고.

## 기여
기여는 환영합니다. 실제 개인정보·증빙·비밀값을 이슈·PR·커밋에 올리지 마십시오. 작업 규칙은 [`CLAUDE.md`](CLAUDE.md)를 따릅니다.

## 라이선스
[MIT](LICENSE)
