# 아키텍처

```text
[브라우저] ──(httpOnly 세션 쿠키)──> apps/web (Next.js App Router, 서버 컴포넌트·서버 액션)
                                         │  Bearer 토큰, 서버 간 호출만
                                         ▼
                                   apps/api (NestJS)
                                   인증 → 멤버십 재확인(매 요청) → ActorContext
                                         │  withTenant(트랜잭션 + set_config(app.tenant_id))
                                         ▼
                 packages/db 서비스 ──> PostgreSQL (owdms_app: RLS FORCE, 최소권한)
                       │                       ▲
                       │ outbox(같은 트랜잭션)  │ worker_pending_tenants() → 기관별 컨텍스트
                       ▼                       │
                 apps/worker ──────────────────┘ 승인 이벤트 → 문서 자동생성(1회)
```

## 계층
| 패키지 | 책임 | 의존 |
|---|---|---|
| `packages/domain` | 순수 업무 규칙: 금액·수량 표현, 재고 부호·재생, 기금배분 합계, 승인 판정, 멱등 해시, 외부연계 상태기계, 역할-동작 표 | 없음 |
| `packages/contracts` | API 요청 스키마(zod), 커넥터 Capability 타입 | zod |
| `packages/db` | SQL migration·RLS·역할, `withTenant`, 트랜잭션 서비스(후원자·후원금·후원품·배분·승인·재고·문서·연계·대시보드), 합성 seed | domain, documents, adapters |
| `packages/documents` | 공통 예시 서식 렌더러(HTML/A4), 이스케이프, 출력 해시 | domain |
| `packages/adapters` | 희망이음 reference 어댑터, 기능 플래그, 내부 검토 XLSX(수식 주입 방지) | ExcelJS |
| `apps/api` | HTTP, 세션 검증, 오류 매핑(code·safeMessage·fieldErrors·requestId), Idempotency-Key | NestJS |
| `apps/worker` | outbox 소비(SKIP LOCKED, job_runs 고유키로 중복 차단) | db |
| `apps/web` | 업무 화면. DB·비밀키에 직접 접근하지 않음 | Next.js |

## 핵심 불변식 구현 위치
| 불변식 | 구현 |
|---|---|
| 기관 격리 | 모든 업무 테이블 RLS FORCE + `(tenant_id, id)` 복합 FK + 트랜잭션 범위 컨텍스트(`0002_rls_roles.sql`, `pool.ts`) |
| 승인 거래 불변 | `guard_approved_header`, `guard_lines` 트리거, `stock_ledger`/`audit_events` append-only + UPDATE/DELETE 권한 없음 |
| 승인=원장=outbox 원자성 | `decideApproval`이 한 트랜잭션에서 로트·원장·잔고·상태·outbox 기록 |
| 음수재고 차단 | 잔고 행 `FOR UPDATE`(고정 순서) + `on_hand >= 0`, `reserved <= on_hand` CHECK |
| 스냅샷 고정 | 승인 요청 시 정규화 JSON 해시, 승인 시 재계산 비교, 문서·연계가 같은 해시 사용 |
| 멱등 | `idempotency_keys`(tenant,key) + 트랜잭션 advisory lock, 다른 payload는 409 |
| 외부상태 분리 | `integration_rows.state` 상태기계(EXPORTED≠SUBMITTED≠VERIFIED) |

## 인증
개발: 합성 계정 선택 로그인(`DEV_LOGIN_ENABLED=true`, 운영에서 설정 시 기동 실패). 토큰은 HMAC 서명(8시간)이며 기관·역할은 매 요청 `auth_memberships()`로 다시 읽어 회수가 즉시 반영된다. 운영: OIDC(Keycloak 또는 기관 IdP)로 교체 예정.

## 배포(제안)
`web + api + worker + PostgreSQL + IdP + 비공개 객체저장`. 운영은 국내 리전 관리형 DB 우선 검토. 개발용 `infra/compose.yaml`은 DB만 제공한다.
