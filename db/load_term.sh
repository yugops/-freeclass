#!/usr/bin/env bash
# EVERY SEMESTER: loads all *.json in a folder as one term. Keeps older terms. Safe to re-run.
# Usage: DATABASE_URL=... ./db/load_term.sh "Even 2027" 2027-01-05 2027-05-20 data/even-2027 [inactive]
set -euo pipefail
TERM_NAME=${1:?term name}; START=${2:?start date}; END=${3:?end date}
DIR=$(realpath "${4:?folder with json files}")
ACTIVATE=true; [ "${5:-}" = inactive ] && ACTIVATE=false
shopt -s nullglob; files=("$DIR"/*.json)
[ ${#files[@]} -gt 0 ] || { echo "no .json files in $DIR" >&2; exit 1; }

cd "$(dirname "$0")"
PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=1 -q"
$PSQL -c "TRUNCATE fc.stg_room_json"
for f in "${files[@]}"; do
  tmp=$(mktemp)
  printf '\\set doc `cat %s`\nINSERT INTO fc.stg_room_json(src, doc) VALUES ('"'"'%s'"'"', :'"'"'doc'"'"'::jsonb);\n' \
    "$f" "$(basename "$f")" > "$tmp"
  $PSQL -f "$tmp"; rm "$tmp"
done
$PSQL -v term_name="$TERM_NAME" -v term_start="$START" -v term_end="$END" -v activate=$ACTIVATE -f 02_etl.sql
$PSQL -c "REFRESH MATERIALIZED VIEW fc.mv_room_utilisation"
echo "loaded term '$TERM_NAME' from ${#files[@]} file(s)"
