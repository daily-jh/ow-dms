# 서버 없이 실행하기

서버(VPS)를 빌리지 않고 OW-DMS를 직접 써 보는 두 가지 방법입니다. 둘 다 **합성(가상) 자료 전용**이며, 화면 위에 시연판 안내가 표시됩니다. 실제 기관 자료·개인정보는 넣지 않습니다.

| | A. GitHub Codespaces | B. 내 PC(Docker Desktop) |
|---|---|---|
| 필요한 것 | GitHub 계정, 브라우저 | Docker Desktop 설치(Windows·Mac) |
| 설치 | 없음 | Docker Desktop만 |
| 비용 | 개인 계정 월 무료 사용량 안에서 무료(초과 시 과금, 사용량은 GitHub 설정에서 확인) | 무료 |
| 다른 사람에게 보여주기 | 포트를 Public으로 바꾸면 임시 주소 공유 가능(Codespace가 켜져 있는 동안만) | 내 PC에서만 접속 |
| 꺼지는 때 | 일정 시간 쓰지 않으면 자동 정지(기본 30분) | 직접 끌 때까지 |

## A. GitHub Codespaces (브라우저만으로)

1. https://github.com/daily-jh/ow-dms 에서 **Code → Codespaces → Create codespace on main**.
2. 처음 한 번은 준비에 몇 분 걸립니다(의존성 설치 → DB 생성·합성자료 → 화면 빌드). 아래 터미널에 진행 상황이 나옵니다.
3. 준비가 끝나면 **포트 3000(OW-DMS 화면)**이 브라우저 새 탭으로 열립니다. 안 열리면 아래 **Ports** 탭에서 3000의 지구본 아이콘을 누릅니다.
4. 시연용 로그인 화면에서 가상 계정을 골라 들어갑니다.

다른 사람에게 보여줄 때: **Ports** 탭 → 3000 우클릭 → **Port Visibility → Public**. 나오는 `https://…-3000.app.github.dev` 주소를 공유합니다. Codespace를 멈추면 주소도 닫힙니다. API 포트(4000)는 공개하지 않습니다.

다시 켤 때: github.com/codespaces 에서 해당 Codespace를 열면 서버가 자동으로 다시 시작됩니다. 저장소를 새로 받아(`git pull`) 화면이 바뀌었으면 터미널에서 `sh .devcontainer/setup.sh && sh .devcontainer/start.sh`.

참고: 개발 서버(`next dev`)는 localhost 이외 주소에서 화면 스크립트를 막기 때문에, Codespaces에서는 빌드본(`next start`)으로 띄웁니다.

## B. 내 PC에서 (Docker Desktop)

1. Docker Desktop을 설치하고 실행합니다.
2. 저장소를 내려받습니다(GitHub의 **Code → Download ZIP** 후 압축 해제, 또는 `git clone`).
3. 그 폴더에서 터미널(Windows는 PowerShell)을 열고:

```sh
docker compose -f infra/compose.local.yaml up -d --build
```

4. 처음은 이미지 빌드에 몇 분 걸립니다. 끝나면 브라우저에서 http://localhost:3000 을 엽니다.

끄기·초기화:

```sh
docker compose -f infra/compose.local.yaml down        # 끄기(자료 유지)
docker compose -f infra/compose.local.yaml down -v     # 끄고 자료 삭제(다음 실행 때 합성자료로 새로 시작)
```

`infra/compose.local.yaml` 안의 비밀번호·키는 이 PC 안에서만 쓰는 공개 예시값이고, 화면 포트는 `127.0.0.1`에만 열려 같은 PC에서만 접속됩니다. 이 파일을 서버 배포에 쓰지 마십시오(서버는 `docs/DEPLOY_DEMO.md`).

## 개발자용

Node 24와 PostgreSQL이 있으면 `README.md`의 빠른 시작(`pnpm dev:api` 등)으로 실행할 수 있습니다. VS Code의 Dev Containers 확장으로 이 저장소를 열면 Codespaces와 같은 환경이 내 PC에 만들어집니다.
