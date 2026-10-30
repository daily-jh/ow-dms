#!/bin/sh
# OW-DMS DB 백업(운영 구성의 backup 컨테이너에서 실행, postgres 이미지의 pg_dump·gpg 사용)
#   loop            매일 BACKUP_HOUR(기본 3시, 한국시간)에 백업하고 BACKUP_KEEP_DAYS(기본 30일) 지난 파일 삭제
#   once            지금 한 번 백업
#   verify FILE     백업 파일을 임시 DB(owdms_restore_check)에 복원해 보고 주요 표 건수를 보여 준 뒤 지운다
#   restore FILE    운영 DB(owdms)를 백업 시점으로 되돌린다(api·worker·web을 먼저 멈출 것)
# 백업 파일은 BACKUP_PASSPHRASE로 암호화된다(gpg AES256). 이 암호를 잃으면 백업을 열 수 없다.
set -eu
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE 필요}"
: "${PGPASSWORD:?PGPASSWORD 필요}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}" TZ="${TZ:-Asia/Seoul}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
HOUR="${BACKUP_HOUR:-3}"

encrypt() { printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "$2" "$1"; }
decrypt() { printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt -o "$2" "$1"; }

backup_once() {
  stamp=$(date +%Y%m%d-%H%M%S)
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  pg_dump -d owdms -Fc -f "$tmp/db.dump"
  pg_restore --list "$tmp/db.dump" > /dev/null # 파일이 온전한지 확인
  encrypt "$tmp/db.dump" "$DIR/owdms-$stamp.dump.gpg.part"
  mv "$DIR/owdms-$stamp.dump.gpg.part" "$DIR/owdms-$stamp.dump.gpg"
  rm -rf "$tmp"
  trap - EXIT
  find "$DIR" -name 'owdms-*.dump.gpg' -mtime +"$KEEP" -delete
  date '+%Y-%m-%d %H:%M:%S %Z' > "$DIR/LAST_SUCCESS"
  echo "백업 완료: owdms-$stamp.dump.gpg ($(du -h "$DIR/owdms-$stamp.dump.gpg" | cut -f1))"
}

restore_into() { # $1 파일, $2 대상 DB
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  decrypt "$1" "$tmp/db.dump"
  pg_restore -d "$2" --clean --if-exists --no-owner --exit-on-error "$tmp/db.dump"
  rm -rf "$tmp"
  trap - EXIT
}

case "${1:-loop}" in
  once) backup_once ;;
  loop)
    echo "백업 대기: 매일 ${HOUR}시($TZ), 보관 ${KEEP}일, 위치 $DIR"
    while true; do
      today=$(date +%Y%m%d)
      if [ "$(date +%H)" -ge "$HOUR" ] && ! ls "$DIR"/owdms-"$today"-*.dump.gpg > /dev/null 2>&1; then
        backup_once || echo "백업 실패: $(date '+%Y-%m-%d %H:%M:%S') — 로그를 확인하십시오." >&2
      fi
      sleep 600
    done ;;
  verify)
    file="${2:?백업 파일 경로 필요}"
    psql -d postgres -qc 'drop database if exists owdms_restore_check' -c 'create database owdms_restore_check'
    restore_into "$file" owdms_restore_check
    psql -d owdms_restore_check -c "select
      (select count(*) from tenants) as 기관, (select count(*) from users) as 사용자,
      (select count(*) from donors) as 후원자, (select count(*) from money_receipts) as 후원금,
      (select count(*) from goods_receipts) as 후원품, (select count(*) from stock_ledger) as 재고원장,
      (select count(*) from audit_events) as 감사기록"
    psql -d postgres -qc 'drop database owdms_restore_check'
    echo "복원 점검 완료: $file" ;;
  restore)
    file="${2:?백업 파일 경로 필요}"
    echo "운영 DB를 $file 시점으로 되돌립니다. api·worker·web이 멈춰 있어야 합니다."
    restore_into "$file" owdms
    echo "복원 완료. api·worker·web을 다시 시작하십시오." ;;
  *) echo "usage: backup.sh loop|once|verify FILE|restore FILE" >&2; exit 2 ;;
esac
