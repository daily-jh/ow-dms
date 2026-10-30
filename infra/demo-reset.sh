#!/bin/sh
# 공개 시연판 초기화: DB 볼륨을 지우고 합성 시연자료로 다시 시작한다. 시연판 전용(실제 기관 DB에 쓰지 말 것).
set -eu
cd "$(dirname "$0")"
docker compose -f compose.demo.yaml rm -sf api worker web db
docker volume rm owdms-demo_db
docker compose -f compose.demo.yaml up -d
