#!/bin/sh
# 오라클 클라우드 무료 서버(Ubuntu 24.04)에 OW-DMS 공개 시연판(합성자료 전용)을 설치·갱신한다.
#   curl -fsSL https://raw.githubusercontent.com/daily-jh/ow-dms/main/infra/oracle-setup.sh | sudo sh
# 도메인을 직접 정하려면: ... | sudo DEMO_DOMAIN=demo.example.org sh
# 다시 실행하면 최신 코드로 갱신한다(비밀값·자료는 유지). 자세한 안내: docs/DEPLOY_ORACLE.md
set -eu

REPO_URL="${REPO_URL:-https://github.com/daily-jh/ow-dms.git}"
APP_DIR="${APP_DIR:-/opt/ow-dms}"

if [ "$(id -u)" -ne 0 ]; then
  echo "관리자 권한이 필요합니다: sudo를 붙여 실행하세요." >&2
  exit 1
fi

echo "[1/5] 필요한 프로그램 설치(docker, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git openssl curl ca-certificates iptables-persistent
systemctl enable --now docker

echo "[2/5] 서버 방화벽에서 웹 포트(80, 443) 열기"
# 오라클 Ubuntu 이미지는 기본 iptables에 REJECT 규칙이 있어, 그 앞에 허용 규칙을 넣어야 한다.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    pos=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}')
    if [ -n "$pos" ]; then
      iptables -I INPUT "$pos" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
netfilter-persistent save >/dev/null

echo "[3/5] 코드 내려받기·갱신: $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

echo "[4/5] 비밀값·주소 설정(처음 한 번만 생성)"
ENV_FILE="$APP_DIR/infra/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -z "${DEMO_DOMAIN:-}" ]; then
    ip=$(curl -fsS https://api.ipify.org) || {
      echo "공인 IP를 알아내지 못했습니다. DEMO_DOMAIN=<주소>를 붙여 다시 실행하세요." >&2
      exit 1
    }
    # 도메인이 없을 때: 공인 IP로 만드는 무료 주소(예: 1-2-3-4.sslip.io)에 HTTPS 인증서를 받는다.
    DEMO_DOMAIN="$(echo "$ip" | tr . -).sslip.io"
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
DEMO_DOMAIN=$DEMO_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -base64 32)
PII_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF
  chmod 600 "$ENV_FILE"
fi
DEMO_DOMAIN=$(sed -n 's/^DEMO_DOMAIN=//p' "$ENV_FILE")

echo "[5/5] 빌드·실행(처음은 10분 안팎 걸릴 수 있습니다)"
docker compose -f "$APP_DIR/infra/compose.demo.yaml" up -d --build

# 누구나 같은 합성 계정으로 들어오므로 매일 새벽 4시(서버 시각)에 합성자료로 초기화한다.
cat > /etc/cron.d/owdms-demo-reset <<EOF
0 4 * * * root sh $APP_DIR/infra/demo-reset.sh > /var/log/owdms-demo-reset.log 2>&1
EOF

echo
echo "완료: https://$DEMO_DOMAIN"
echo "인증서 발급에 1~2분 걸릴 수 있습니다. 열리지 않으면 docs/DEPLOY_ORACLE.md의 '문제 해결'을 보세요."
