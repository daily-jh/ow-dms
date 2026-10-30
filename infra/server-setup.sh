#!/bin/sh
# OW-DMS 정식 운영 서버 설치·갱신(Ubuntu 24.04, 국내 클라우드 서버 권장). 실제 기관 자료용.
#   curl -fsSL https://raw.githubusercontent.com/daily-jh/ow-dms/main/infra/server-setup.sh | sudo OWDMS_DOMAIN=donation.기관도메인 sh
# 다시 실행하면 최신 코드로 갱신한다(비밀값·자료·백업은 유지). 자세한 안내: docs/OPERATIONS.md
set -eu

REPO_URL="${REPO_URL:-https://github.com/daily-jh/ow-dms.git}"
APP_DIR="${APP_DIR:-/opt/ow-dms}"
COMPOSE="docker compose -f $APP_DIR/infra/compose.prod.yaml"

if [ "$(id -u)" -ne 0 ]; then
  echo "관리자 권한이 필요합니다: sudo를 붙여 실행하세요." >&2
  exit 1
fi

echo "[1/5] 필요한 프로그램 설치(docker, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git openssl curl ca-certificates
# 작은 디스크(예: 10GB)가 컨테이너 기록으로 차지 않도록 기록 파일 크기를 제한한다(처음 한 번).
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker

# 메모리가 작은 서버(예: 1GB)는 스왑을 잡아 둔다(없을 때만 2GB).
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  echo "메모리 ${mem_mb}MB: 스왑 2GB 설정"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile > /dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[2/5] 코드 내려받기·갱신: $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$APP_DIR/backups"
chmod 700 "$APP_DIR/backups"

echo "[3/5] 비밀값 설정(처음 한 번만 생성)"
ENV_FILE="$APP_DIR/infra/.env"
FIRST=0
if [ ! -f "$ENV_FILE" ]; then
  if [ -z "${OWDMS_DOMAIN:-}" ]; then
    echo "OWDMS_DOMAIN(접속 주소)을 지정하세요. 예: ... | sudo OWDMS_DOMAIN=donation.example.or.kr sh" >&2
    exit 1
  fi
  FIRST=1
  umask 077
  {
    echo "OWDMS_DOMAIN=$OWDMS_DOMAIN"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "SESSION_SECRET=$(openssl rand -base64 32)"
    echo "PII_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "BACKUP_PASSPHRASE=$(openssl rand -hex 24)"
    echo "BACKUP_KEEP_DAYS=30"
    echo "BACKUP_HOUR=3"
    echo "BACKUP_DIR=$APP_DIR/backups"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

echo "[4/5] 이미지 받기·실행"
# 디스크가 작으면 새 이미지를 받을 자리가 모자랄 수 있어, 먼저 쓰지 않는 옛 이미지·빌드 찌꺼기를 지운다(자료·백업은 그대로).
docker image prune -f > /dev/null || true
docker builder prune -af > /dev/null 2>&1 || true
avail_mb=$(df -Pm / | awk 'NR==2 {print $4}')
if [ "$avail_mb" -lt 2500 ]; then
  echo "경고: 남은 디스크가 ${avail_mb}MB입니다. 새 이미지를 받으려면 약 2.5GB가 필요합니다." >&2
  echo "      'docker system df'로 사용량을 보고, 업체 콘솔에서 스토리지를 늘리는 것을 검토하십시오." >&2
fi
# GitHub에서 미리 만든 이미지를 받는다. 받을 수 없으면(비공개·네트워크 문제) 이 서버에서 직접 빌드한다.
if $COMPOSE pull --quiet; then
  $COMPOSE up -d --no-build
else
  echo "미리 만든 이미지를 받지 못해 이 서버에서 빌드합니다(10분 이상 걸릴 수 있습니다)."
  $COMPOSE up -d --build
fi
# 갱신 뒤 남은 옛 이미지를 지운다.
docker image prune -f > /dev/null || true

echo "[5/5] 상태"
$COMPOSE ps --format '{{.Service}}: {{.Status}}'
DOMAIN=$(sed -n 's/^OWDMS_DOMAIN=//p' "$ENV_FILE")

echo
echo "완료: https://$DOMAIN"
if [ "$FIRST" = 1 ]; then
  echo
  echo "────────────────────────────────────────────────────────────"
  echo " 아래 두 값을 서버 밖 안전한 곳(기관 금고·비밀번호 관리 프로그램)에 지금 보관하십시오."
  echo " 서버를 잃으면 이 값 없이는 백업을 열거나 후원자 연락처를 복호화할 수 없습니다."
  echo " 메신저·메일·문서 파일로 보내지 마십시오. 이 화면을 닫으면 다시 표시하지 않습니다."
  echo
  grep -E '^(BACKUP_PASSPHRASE|PII_ENCRYPTION_KEY)=' "$ENV_FILE" | sed 's/^/  /'
  echo "────────────────────────────────────────────────────────────"
  echo
  echo "첫 관리자 만들기(기관코드는 영문, 아이디는 영문 소문자·숫자):"
  echo "  sudo $COMPOSE run --rm bootstrap ../../node_modules/.bin/tsx src/cli.ts create-admin <기관코드> <기관이름> <아이디> <이름>"
fi
