#!/bin/sh
# Codespace가 켜질 때마다 api·worker·web을 백그라운드로 띄운다. 로그: /tmp/owdms-*.log
cd "$(dirname "$0")/.."
(cd apps/api && nohup ../../node_modules/.bin/tsx src/main.ts > /tmp/owdms-api.log 2>&1 &)
(cd apps/worker && nohup ../../node_modules/.bin/tsx src/main.ts > /tmp/owdms-worker.log 2>&1 &)
(cd apps/web && nohup ./node_modules/.bin/next start -p 3000 > /tmp/owdms-web.log 2>&1 &)
echo "OW-DMS 시작 중: 포트 3000(OW-DMS 화면)을 여세요. 로그는 /tmp/owdms-*.log"
