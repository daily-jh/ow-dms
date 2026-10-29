# 오라클 클라우드 무료 서버에 시연판 올리기

오라클 클라우드의 Always Free(평생 무료) 서버에 **합성자료 전용 공개 시연판**을 올리는 순서입니다. 실제 기관 자료·개인정보는 넣지 않습니다.
화면 문구·메뉴 이름은 오라클이 바꿀 수 있으니, 비슷한 이름을 찾아 진행하십시오.

준비물: 이메일, 휴대전화, 본인 명의 신용·체크카드(본인 확인용. 무료 한도 안에서는 청구되지 않음)

## 1. 가입 (10분)

1. https://www.oracle.com/kr/cloud/free/ 에서 **무료로 시작하기**.
2. **홈 리전**은 **South Korea Central (Seoul)** 또는 **South Korea North (Chuncheon)**을 고릅니다.
   무료 서버는 홈 리전에서만 만들 수 있고, 홈 리전은 나중에 바꿀 수 없습니다.
3. 카드 인증까지 마치면 콘솔(관리 화면)에 들어갑니다. 계정 준비에 몇 분~몇십 분 걸릴 수 있습니다.

## 2. 서버 만들기 (10분)

콘솔 왼쪽 위 메뉴 → **Compute → Instances → Create instance**

| 항목 | 고를 값 |
|---|---|
| Name | `owdms-demo` (아무 이름) |
| Image | **Canonical Ubuntu 24.04** (Change image에서 선택) |
| Shape | Change shape → **Ampere** → **VM.Standard.A1.Flex**, OCPU **2**, Memory **12 GB** (Always Free 표시 확인) |
| Networking | 새 가상 네트워크(VCN)와 **공용(public) 서브넷** 만들기, **Assign a public IPv4 address** 켜기 |
| Add SSH keys | **Generate a key pair for me** → **Save private key** 눌러 키 파일 저장(잃어버리면 접속 불가) |
| Boot volume | 기본값 |

**Create**를 누르고 상태가 **Running**이 되면, 화면의 **Public IP address**를 적어 둡니다.

"Out of capacity(용량 부족)"가 나오면: 다른 Availability domain을 고르거나, 몇 시간 뒤 다시 시도합니다. 무료 ARM 서버는 자주 동납니다.

## 3. 웹 포트 열기 (3분)

서버 화면 → **Primary VNIC**의 **Subnet** 링크 → **Security Lists** → **Default Security List** → **Add Ingress Rules**를 두 번 추가합니다.

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(서버 안쪽 방화벽은 다음 단계의 스크립트가 자동으로 엽니다.)

## 4. 서버에 접속해 설치 (명령 1줄, 기다리는 시간 10~20분)

**Windows**: 시작 메뉴에서 PowerShell을 열고, **Mac**: 터미널을 열고 아래를 입력합니다. `키파일경로`는 2단계에서 저장한 파일, `공인IP`는 적어 둔 주소입니다.

```sh
ssh -i 키파일경로 ubuntu@공인IP
```

처음 접속할 때 `yes`를 입력합니다. (Mac·리눅스에서 권한 오류가 나면 먼저 `chmod 600 키파일경로`)

접속되면 아래 한 줄을 붙여넣습니다.

```sh
curl -fsSL https://raw.githubusercontent.com/daily-jh/ow-dms/main/infra/oracle-setup.sh | sudo sh
```

스크립트가 하는 일: 도커 설치 → 서버 방화벽 80·443 열기 → 코드 내려받기 → 비밀값 자동 생성(`/opt/ow-dms/infra/.env`, 관리자만 읽기) → 빌드·실행 → 매일 새벽 4시 합성자료 초기화 예약.

끝나면 `완료: https://1-2-3-4.sslip.io` 같은 주소가 나옵니다. 브라우저로 열면 시연용 로그인 화면이 보입니다.
도메인이 없어도 되도록 공인 IP로 만든 무료 주소(sslip.io)를 씁니다. 본인 도메인을 쓰려면 DNS A 레코드를 공인 IP로 맞춘 뒤, 처음 설치할 때 `sudo DEMO_DOMAIN=demo.내도메인 sh`로 실행합니다.

## 갱신·관리

| 하고 싶은 것 | 명령(서버에 접속한 상태에서) |
|---|---|
| 최신 코드로 갱신 | 4단계의 설치 명령을 다시 실행(비밀값·자료 유지) |
| 지금 바로 초기화 | `sudo sh /opt/ow-dms/infra/demo-reset.sh` |
| 상태 보기 | `sudo docker compose -f /opt/ow-dms/infra/compose.demo.yaml ps` |
| 기록 보기 | `sudo docker compose -f /opt/ow-dms/infra/compose.demo.yaml logs --tail 50` |
| 끄기 | `sudo docker compose -f /opt/ow-dms/infra/compose.demo.yaml down` |

## 문제 해결

- **주소가 아예 안 열림**: 3단계 Ingress 규칙(80, 443)을 확인합니다.
- **인증서 오류·접속 거부**: 처음 1~2분은 인증서를 받는 중입니다. 계속되면 `... logs caddy`로 확인합니다. sslip.io 인증서 발급이 막히면 무료 도메인(예: DuckDNS)이나 본인 도메인을 `DEMO_DOMAIN`으로 지정해 `/opt/ow-dms/infra/.env`를 고친 뒤 `sudo docker compose -f /opt/ow-dms/infra/compose.demo.yaml up -d`.
- **서버가 사라지거나 멈춤**: 오라클은 무료 전용 계정에서 오래 한가한(CPU 등 사용률이 낮은) 무료 서버를 회수할 수 있습니다. 계정을 **Pay As You Go**로 올리면 무료 한도 안에서는 계속 청구 없이 쓸 수 있고 회수 대상에서 빠집니다. 올리기 전에 오라클의 현재 정책과 요금을 직접 확인하십시오.

## 지켜야 할 것

- 시연판에는 합성(가상) 자료만 둡니다. 실제 기관·후원자 정보를 넣지 않습니다.
- `.env` 파일(비밀값)과 SSH 키 파일을 다른 곳에 올리거나 공유하지 않습니다.
- DB·API 포트는 열지 않습니다(80·443만).
