#!/usr/bin/env bash
set -u

OPTIONS=/data/options.json

export PLANETE_USER="$(jq -r '.planete_user' "$OPTIONS")"
export PLANETE_PASS="$(jq -r '.planete_pass' "$OPTIONS")"
export F4S_USER="$(jq -r '.f4s_user' "$OPTIONS")"
export F4S_PASS="$(jq -r '.f4s_pass' "$OPTIONS")"
export LOOP_MINUTES="1440"   # the script loops by itself (every 5 min); it comes back here once a day, as a clean restart

if [ -z "$PLANETE_USER" ] || [ -z "$PLANETE_PASS" ]; then
  echo "STOP: fill in the Planete username/password in this add-on's Configuration tab, then restart it."
  sleep 3600
  exit 1
fi

cd /app/tools
echo "TROCA-MISTO sync starting on this Pi $(date)"

while true; do
  node planete-sync.mjs
  echo "sync stopped (code $?) — restarting in 30s"
  sleep 30
done
