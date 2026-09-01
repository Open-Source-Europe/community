#!/usr/bin/env bash
# Back up everything that cannot be recreated from git.
#
# One Postgres database holds n8n's workflows, its credentials, AND the
# ose_applications Data table with applicant state — so this single dump is the
# whole backup. Workflow JSON in automation/n8n/ is a copy for review, not a
# restore path: it carries no credentials and no applicant rows.
#
# Run from anywhere. Installed as a daily cron by the runbook in README.md.
set -euo pipefail

INFRA_DIR="${INFRA_DIR:-$HOME/community/automation/infra}"
DEST="${DEST:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$DEST"
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT="$DEST/n8n-$STAMP.sql.gz"

cd "$INFRA_DIR"
docker compose exec -T postgres pg_dump -U n8n --clean --if-exists n8n | gzip > "$OUT"

# A dump that restores nothing is worse than no dump: fail loudly instead of
# leaving a plausible-looking empty file behind.
SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" -lt 10240 ]; then
  echo "ERROR: dump is only ${SIZE} bytes — refusing to treat this as a backup" >&2
  mv "$OUT" "$OUT.SUSPECT"
  exit 1
fi
if ! gzip -t "$OUT"; then
  echo "ERROR: dump failed gzip integrity check" >&2
  exit 1
fi
# NB: not `grep -q` — it exits on first match, gunzip then dies of SIGPIPE, and
# `set -o pipefail` reports the pipeline as failed precisely BECAUSE the string
# was found. `grep -c` reads to EOF, so there is no SIGPIPE to misread.
TABLES=$(gunzip -c "$OUT" | grep -c '^CREATE TABLE' || true)
if [ "$TABLES" -lt 1 ]; then
  echo "ERROR: dump contains no CREATE TABLE — schema missing" >&2
  exit 1
fi

find "$DEST" -name 'n8n-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "$(date -u +%FT%TZ) ok $OUT ($((SIZE/1024)) KiB, ${TABLES} tables, keeping ${KEEP_DAYS}d)"
