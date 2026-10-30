# 권한표

판정 위치: 서비스 `requireAction()`(동작) + PostgreSQL RLS(기관) + 복합 FK(교차기관 참조). 화면은 안내용으로만 숨긴다. 원본: `packages/domain/src/permissions.ts`.

| 동작 | 후원담당 | 물품담당 | 회계 | 승인권자 | 영수증 | 기관관리자 | 감사 |
|---|---|---|---|---|---|---|---|
| donor.read | ● | ● | ● | ● | ● | ● | ● |
| donor.write | ● | | | | | | |
| donor.private.read(연락처 마스킹 열람) | ● | | | | | | |
| donor.tax.read | | | | | ● | | |
| money.draft | ● | | | | | | |
| money.read | ● | | ● | ● | ● | | ● |
| goods.draft / goods.read | ●/● | ●/● | /● | /● | | | /● |
| distribution.draft(출고 반영 포함) | | ● | | | | | |
| approval.request | ● | ● | | | | | |
| approval.decide | | | | ● | | | |
| document.generate / read | ●/● | ●/● | /● | /● | /● | | /● |
| integration.prepare / read | ●/● | /● | /● | /● | | | /● |
| audit.read | | | | | | ● | ● |
| settings.write | | | | | | ● | |
| user.manage (직원 계정 생성·비밀번호 초기화·권한 변경) | | | | | | ● | |

추가 규칙
- 자기승인 금지: 요청자와 결정자가 같으면 거부(`SELF_APPROVAL_FORBIDDEN`). 소규모 기관 겸직은 `memberships.self_approval_exception`으로만 허용하며 기관 승인 기록이 필요하다(화면 미구현).
- 기관관리자는 개인정보 전체 열람 권한이 없다.
- 정정 요청: `approval.request`와 해당 업무의 초안 권한(후원품=goods.draft, 후원금=money.draft, 배분=distribution.draft)이 모두 필요. 정정 승인은 `approval.decide`, 자기승인 금지 동일.
- 월 마감·재개방: `approval.decide`(승인권자). 재개방은 사유 필수이며 감사기록에 남는다. 점검표 조회는 `goods.read`.
- 감사기록 조회(`audit.read`): 감사·기관관리자. 조회 자체도 ACCESS로 기록.
- 시스템 worker(`SYSTEM_WORKER`)는 로그인 불가 계정이며 문서 생성·조회만 한다.
- 시설·사업 범위·금액별 승인 한도는 아직 미구현(Phase 2, V10).
