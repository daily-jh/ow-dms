# 정식 운영 안내

실제 기관 자료로 OW-DMS를 운영하기 위한 설치·관리 절차입니다. 시연판(`docs/DEPLOY_DEMO.md`, `docs/DEPLOY_ORACLE.md`)과 달리 합성 계정 로그인·합성자료가 모두 꺼져 있고, 비밀번호와 2단계 인증(OTP)이 필수입니다.

> 이 문서의 법·제도 관련 항목은 일반적인 점검 목록이며 법률 자문이 아닙니다. 기관의 개인정보 보호책임자·법무 검토를 거쳐 확정하십시오(**기관 검토 필요**).

## 1. 준비물

| 항목 | 권장 |
|---|---|
| 서버 | **국내 리전** 클라우드 서버 1대(네이버클라우드·NHN Cloud·KT Cloud 등), Ubuntu 24.04, 2 vCPU·4GB 메모리 이상, 디스크 50GB 이상. 요금은 각 업체 요금표에서 확인 |
| 도메인 | 기관 도메인의 하위 주소(예: `donation.기관도메인`) 하나. DNS A 레코드를 서버 공인 IP로 지정 |
| 방화벽(업체 콘솔의 ACG·보안그룹) | 80·443은 전체 허용, 22(SSH)는 **기관 사무실 IP만** 허용 |
| 보관 장소 | 백업 암호·암호화 키를 서버 밖에 보관할 곳(기관 금고, 비밀번호 관리 프로그램) |
| 사람 | 기관관리자 **2명 이상**(한 명이 잠기거나 휴대폰을 잃어도 다른 관리자가 초기화할 수 있게) |

## 2. 설치(30분 안팎)

서버에 SSH로 접속해 한 줄을 실행합니다. `OWDMS_DOMAIN`에 1단계에서 정한 주소를 넣습니다.

```sh
curl -fsSL https://raw.githubusercontent.com/daily-jh/ow-dms/main/infra/server-setup.sh | sudo OWDMS_DOMAIN=donation.기관도메인 sh
```

스크립트가 하는 일:
1. 도커 설치
2. 코드 내려받기(`/opt/ow-dms`)
3. 비밀값 자동 생성(`/opt/ow-dms/infra/.env`, 관리자만 읽기)
4. 빌드·실행: DB, API, 작업 처리기, 화면, HTTPS, 매일 백업

설치가 끝나면 **`BACKUP_PASSPHRASE`와 `PII_ENCRYPTION_KEY`가 한 번 표시됩니다.** 그 자리에서 서버 밖 안전한 곳에 옮겨 적으십시오.
- 서버가 망가지면 이 두 값 없이는 백업을 열 수 없고, 후원자 연락처와 OTP 정보도 복호화할 수 없습니다.
- 메신저·메일·문서 파일로 보내지 마십시오.

### 첫 관리자

```sh
sudo docker compose -f /opt/ow-dms/infra/compose.prod.yaml run --rm bootstrap \
  ../../node_modules/.bin/tsx src/cli.ts create-admin <기관코드> <기관이름> <아이디> <이름>
# 예: create-admin hope1 "희망복지관" kim.admin "김관리"
```

화면에 임시 비밀번호가 한 번 표시됩니다.
1. `https://<주소>`에서 임시 비밀번호로 로그인합니다.
2. 비밀번호를 바꾸고 OTP 앱을 등록합니다.
3. **기준정보**에서 법인·시설·창고·품목·기금을 입력합니다.
4. **직원 관리**에서 두 번째 관리자와 직원 계정을 만듭니다.

같은 명령으로 다른 기관을 추가할 수 있습니다. 기관끼리는 서로 자료가 보이지 않습니다.

## 3. 직원 계정

- **만들기**: 관리자가 **직원 관리**에서 아이디·이름·역할을 정하면 임시 비밀번호가 한 번 표시됩니다. 직원에게 **직접(대면·전화)** 전달하고, 메신저·메일로 보내지 마십시오.
- **첫 로그인**: 직원은 비밀번호를 바꾸고 OTP 앱(Google Authenticator, Microsoft Authenticator 등)을 등록해야 업무 화면이 열립니다.
- **잠김(5회 실패)·비밀번호 분실**: 15분 뒤 자동으로 풀립니다. 바로 풀려면 관리자가 **임시 비밀번호 발급**을 누릅니다.
- **휴대폰 분실·교체**: 임시 비밀번호를 발급할 때 **2단계 인증도 초기화**를 체크합니다.
- **퇴사·전보**: 그날 바로 **권한 회수**를 누릅니다. 즉시 로그인이 막히고 열려 있던 화면도 끊깁니다.
- **역할은 최소한으로**: 예를 들어 물품담당은 후원자 연락처를 보지 않습니다. 기관관리자 역할도 후원자 개인정보 열람을 포함하지 않습니다. 역할별 권한은 `docs/PERMISSIONS.md`에 있습니다.

## 4. 백업과 복원

자동 백업은 매일 새벽 3시(한국시간)에 실행됩니다.
- DB 전체를 `BACKUP_PASSPHRASE`로 암호화(gpg AES256)해 `/opt/ow-dms/backups`에 저장합니다.
- 30일이 지난 파일은 지웁니다.
- 마지막 성공 시각은 `/opt/ow-dms/backups/LAST_SUCCESS`에서 확인합니다.

| 하고 싶은 것 | 명령 |
|---|---|
| 지금 백업 | `sudo docker compose -f /opt/ow-dms/infra/compose.prod.yaml exec backup sh /usr/local/bin/backup.sh once` |
| 백업이 열리는지 점검(**매월 권장**) | `... exec backup sh /usr/local/bin/backup.sh verify /backups/<파일이름>` → 임시 DB에 복원해 기관·사용자·후원금 건수를 보여 주고 지웁니다 |
| 백업 시점으로 되돌리기 | 아래 순서 |

되돌리는 순서(되돌린 시점 이후 입력은 사라집니다):

```sh
cd /opt/ow-dms/infra
sudo docker compose -f compose.prod.yaml stop api worker web
sudo docker compose -f compose.prod.yaml exec backup sh /usr/local/bin/backup.sh restore /backups/<파일이름>
sudo docker compose -f compose.prod.yaml start api worker web
```

**서버 밖 사본은 꼭 따로 두십시오.** 서버 디스크에만 있는 백업은 서버와 함께 잃을 수 있습니다. 다음 중 하나 이상을 정해 두십시오.
- 클라우드 업체의 서버 스냅샷·백업 상품을 켭니다.
- 백업 파일을 주기적으로(예: 매주) 기관 내부 PC나 업체 오브젝트 스토리지로 복사합니다. 파일은 암호화되어 있으므로 암호 없이는 열 수 없습니다.

  ```sh
  scp ubuntu@서버:/opt/ow-dms/backups/owdms-*.dump.gpg 보관폴더/
  ```

**새 서버로 옮길 때**:
1. 새 서버에서 2단계 설치를 합니다.
2. `infra/.env`의 `PII_ENCRYPTION_KEY`와 `BACKUP_PASSPHRASE`를 보관해 둔 값으로 바꿉니다.
3. `up -d`로 다시 띄웁니다.
4. 백업 파일을 `/opt/ow-dms/backups`에 복사합니다.
5. 위 순서대로 되돌립니다.

## 5. 갱신·점검

| 하고 싶은 것 | 명령 |
|---|---|
| 최신 버전으로 갱신 | 2단계 설치 명령을 다시 실행합니다(비밀값·자료·백업 유지). 갱신 전에 `backup.sh once`로 백업하십시오 |
| 상태 보기 | `sudo docker compose -f /opt/ow-dms/infra/compose.prod.yaml ps` |
| 기록 보기 | `... logs --tail 100 api` (개인정보는 기록하지 않음) |
| 서버 보안 업데이트 | Ubuntu 자동 보안 업데이트(unattended-upgrades)는 기본으로 켜져 있습니다. 월 1회 `sudo apt upgrade` 후 재부팅을 권장합니다 |

## 6. 운영 전 기관이 정할 것(기관 검토 필요)

- 개인정보 처리방침에 후원자 정보 처리 목적·항목·보유기간·처리위탁(클라우드 업체) 반영
- 후원자 정보·회계 증빙 **보존기간**과 파기 절차(시스템의 자동 파기 기능은 아직 없음)
- 개인정보 보호책임자·접근권한 관리 담당 지정, 직원 개인정보 보호 교육
- 접근기록 점검 주기(**감사기록** 메뉴: 로그인 성공·실패, 계정 관리, 장부 변경이 남음)
- 기존 자료 이관 방법과 시점, 병행 운영 기간
- 백업 사본 보관 장소와 복원 점검 담당자

## 7. 아직 없는 것

- 은행·CMS 파일 반입·대조, 기부금영수증 발급, 희망이음 실제 연계도 아직 없습니다(`docs/IMPLEMENTATION_PLAN.md`, `docs/VALIDATION_REGISTER.md`).
- 서버 장애 알림(모니터링)은 클라우드 업체의 기본 모니터링·알림을 켜서 대신합니다.
