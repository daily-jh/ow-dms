# 결정 기록 (ADR 요약)

## D1 라이선스: MIT
오픈소스 우선 개발 요청에 따라 MIT 채택(2026-10-29). 기관별 비공개 설정·서식은 별도 저장소/배포 설정으로 분리한다. CiviCRM(AGPL) 코드는 결합하지 않는다.

## D2 런타임·패키지 (착수 시 확인 버전, lockfile 고정)
| 영역 | 채택 | 비고 |
|---|---|---|
| Node.js | 24 LTS 권장(`.nvmrc`), 엔진 ≥22 | 개발 환경에서는 22.22로 검증. CI는 24 |
| pnpm | 10.28 | |
| TypeScript | 5.9.3 | 7.x(네이티브)는 데코레이터 호환 확인 전 보류 |
| Next.js / React | 16.4.3 / 19.3.1 | App Router, 서버 액션 |
| NestJS | 12.3.2 | 생성자 주입은 `@Inject(TOKEN)` 명시(메타데이터 비의존) |
| PostgreSQL | 16.10(개발·CI에서 검증) | 명세 권장 18은 승격 시 RLS·잠금 시험 재실행 후 채택 |
| pg | 8.23.1 | int8·numeric·date는 문자열로 수신 |
| zod | 4.6.7 | |
| ExcelJS | 4.4.0 | |
| Vitest | 4.1.12 | 5.x는 이후 검토 |

## D3 ORM: SQL-first(명세의 Drizzle 대신, 현 단계)
RLS·트리거·복합 FK·부분 UNIQUE·`FOR UPDATE` 순서를 명시적으로 통제하기 위해 SQL migration + 파라미터 SQL 서비스로 시작했다. Drizzle 도입은 스키마 타입 생성 이점과 비교해 Phase 2 초에 재결정한다. ORM 혼용은 하지 않는다.

## D4 서비스 위치
트랜잭션 서비스는 `packages/db`에 둔다. API·worker·seed·통합시험이 같은 코드를 쓰도록 하여 화면/HTTP 없이도 원장 규칙을 실제 DB로 시험한다.

## D5 인증
개발은 합성 계정 서명 토큰, 운영은 OIDC(미구현). 기관·역할은 토큰에 싣지 않고 매 요청 DB 멤버십에서 판정한다.
→ D11로 갱신: 운영은 자체 비밀번호+OTP. OIDC는 기관 IdP가 있을 때 추가한다.

## D6 배분 = 예약 후 출고
승인 시 `reserved`를 확보하고(가용량 감소), 출고 반영 시 원장 차감. 승인과 실출고·전달확인을 분리하라는 명세 6.3·22.2를 따른다.

## D7 문서는 HTML(A4) 우선
서버 PDF(격리 Playwright worker)는 다음 단계. 현재는 CSP `default-src 'none'`로 원격 리소스를 차단한 HTML 미리보기와 브라우저 인쇄를 제공한다.

## D8 Tailwind 미사용(현 단계)
의존성 최소화를 위해 CSS 변수 기반 단일 스타일시트. 라이트/다크 대응, 색상 외 글자 상태 표시.

## D9 비용
무료 소프트웨어 사용이 무료 운영을 뜻하지 않는다. 호스팅·백업·KMS·IdP·유지보수 견적은 V14에서 별도 산정.

## D10 시연판 실행 방식
- 공개 시연판·내 PC·Codespaces 모두 `DEMO_MODE=true`일 때만 운영 빌드에서 합성 계정 로그인을 허용하고, 전 화면에 합성자료·개인정보 입력 금지 안내를 띄운다. `DEMO_MODE` 없이 운영에서 개발 로그인을 켜면 API가 시작을 거부한다.
- 하나의 이미지(Dockerfile)로 api·worker·web·bootstrap을 실행한다. bootstrap은 migration 후 빈 DB일 때만 합성자료를 넣고, 운영에서는 앱 DB 계정 비밀번호를 개발 기본값에서 반드시 바꾼다.
- 관리형 DB는 `CREATE ROLE` 제약이 흔해 시연판은 PostgreSQL을 함께 띄운다. 실제 기관 운영 배포 구성은 검증 항목 확보 후 별도로 정한다.
- Codespaces는 `next dev`가 외부 주소의 스크립트를 막으므로 빌드본(`next start`)으로 띄우고, server action 출처는 `SERVER_ACTIONS_ALLOWED_ORIGINS`로 허용한다.

## D11 운영 인증: 자체 비밀번호 + OTP 2단계 인증
- 소규모 복지기관은 별도 IdP(Keycloak·기관 SSO)를 운영하기 어려워, 시스템 안에 비밀번호(scrypt N=2^15)와 TOTP(RFC 6238, OTP 앱)를 둔다. 운영(`NODE_ENV=production`)에서는 2단계 인증 필수(`REQUIRE_MFA=false`로만 끔).
- 인증정보(`user_credentials`)·세션(`auth_sessions`)은 앱 계정에 권한을 주지 않고 SECURITY DEFINER 함수로만 다룬다. 토큰은 서버 세션을 가리켜 로그아웃·비밀번호 초기화·권한 회수가 즉시 반영된다.
- 임시 비밀번호는 저장·로그하지 않고 생성 응답에서 한 번만 보여 준다. 첫 로그인 때 비밀번호 변경과 OTP 등록을 마쳐야 업무 API가 열린다.
- 5회 실패 시 15분 잠금, 관리자 초기화로 해제. 관리자는 자기 관리자 권한을 스스로 없앨 수 없다.
- 직원 계정 관리는 기관관리자(`user.manage`)만, 자기 기관 안에서만(DB 함수에서도 재검사).
