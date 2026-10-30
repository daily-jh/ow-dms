# 공개 시연판 배포 안내

이 문서는 **합성(가상) 자료만 들어 있는 공개 시연판**을 서버 한 대에 띄우는 방법입니다.
실제 기관 운영 배포가 아닙니다. 실제 기관 자료·후원자 개인정보는 이 구성에 넣지 않습니다(운영 배포 조건은 `docs/IMPLEMENTATION_PLAN.md`·`docs/VALIDATION_REGISTER.md` 참고).

## 구성

| 서비스 | 역할 | 외부 공개 |
|---|---|---|
| `caddy` | HTTPS 종단(Let's Encrypt 자동 발급), `noindex` 헤더 | 80·443만 |
| `web` | Next.js 화면 | 아니오(caddy 뒤) |
| `api` | NestJS API | 아니오(web만 내부망으로 호출) |
| `worker` | outbox 처리(문서 자동 생성 등) | 아니오 |
| `bootstrap` | 시작 시 1회: migration → 앱 DB 계정 비밀번호 교체 → **빈 DB일 때만** 합성 시연자료 입력 | 아니오 |
| `db` | PostgreSQL 16 | 아니오(포트 미개방) |

앱은 `owdms_app`(superuser·BYPASSRLS 아님) 계정으로 접속하고, 기관 격리는 RLS로 강제됩니다.
관리형 DB 서비스는 `CREATE ROLE` 권한이 없는 경우가 많아, 시연판은 PostgreSQL을 함께 띄우는 구성으로 했습니다.

`DEMO_MODE=true`일 때만:
- 운영 빌드에서도 합성 계정 로그인(`DEV_LOGIN_ENABLED`)이 허용됩니다. `DEMO_MODE` 없이 운영에서 켜면 API가 시작을 거부합니다.
- 모든 화면 위에 "공개 시연판·합성자료·개인정보 입력 금지" 안내가 표시됩니다.

## 준비물

- Docker Engine과 Compose 플러그인이 설치된 리눅스 서버 1대(2 vCPU·4GB 메모리 이상 권장). 국내 리전을 권장합니다.
- 서버 공인 IP를 가리키는 도메인(예: `demo.기관도메인`)의 DNS A 레코드.
- 방화벽에서 80·443(그리고 관리용 SSH)만 허용.

## 처음 띄우기

```sh
git clone https://github.com/daily-jh/ow-dms.git && cd ow-dms
cp .env.demo.example infra/.env
# infra/.env를 열어 값 채우기. 서버에서 직접 생성하고 다른 곳에 붙여넣지 않는다.
#   DEMO_DOMAIN=demo.example.org
#   POSTGRES_PASSWORD=$(openssl rand -hex 24)
#   APP_DB_PASSWORD=$(openssl rand -hex 24)      # 개발 기본값(owdms_app_dev)은 거부됨
#   SESSION_SECRET=$(openssl rand -base64 32)
#   PII_ENCRYPTION_KEY=$(openssl rand -base64 32)
chmod 600 infra/.env
docker compose -f infra/compose.demo.yaml up -d --build
docker compose -f infra/compose.demo.yaml logs bootstrap   # "demo seed inserted" 확인
```

몇십 초 뒤 `https://<DEMO_DOMAIN>`에서 시연용 로그인 화면이 열립니다.

## 갱신·초기화

```sh
git pull && docker compose -f infra/compose.demo.yaml up -d --build   # 새 migration은 bootstrap이 적용
sh infra/demo-reset.sh                                                  # DB를 지우고 합성자료로 다시 시작
```

누구나 같은 합성 계정으로 들어오므로, `demo-reset.sh`를 주기적으로(예: 매일 새벽 cron) 실행하는 것을 권장합니다.

## 하지 않는 것

- 실제 기관 자료 이관, 실제 영수증 발급, 희망이음 실제 전송(시연판에서도 `submit`은 비활성).
- DB·API 포트 외부 개방.
- 비밀값을 저장소·이미지·로그에 넣기(이미지는 실행 시 환경변수로만 받음).
