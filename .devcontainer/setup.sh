#!/bin/sh
# Codespace를 처음 만들 때 1회: 의존성 설치 → DB 준비 대기 → migration + 합성 시연자료
set -eu
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
i=0
until node -e "const{Client}=require('./packages/db/node_modules/pg');const c=new Client(process.env.MIGRATION_DATABASE_URL);c.connect().then(()=>c.end()).catch(()=>process.exit(1))"; do
  i=$((i+1)); [ "$i" -gt 30 ] && { echo "DB가 준비되지 않았습니다"; exit 1; }
  sleep 2
done
ALLOW_DB_RESET=true pnpm db:reset
# 개발 서버(next dev)는 localhost 외 주소에서 화면 스크립트를 막으므로, 빌드본으로 띄운다.
pnpm --filter @owdms/web build
