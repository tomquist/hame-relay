#!/bin/bash
# Usage: suite.sh <tag> [reps]
# Runs every scenario against the build measure.mjs is pointed at (REPO or
# RELAY_IMAGE); results land in results/<tag>-<scenario>-<rep>.json.
S=$(cd "$(dirname "$0")" && pwd); TAG=$1; REPS=${2:-2}
for r in $(seq 1 "$REPS"); do
  DEVICES=6  POLL_MS=1000 node "$S/measure.mjs" "$TAG-steady-$r" 150
  DEVICES=50 POLL_MS=200  node "$S/measure.mjs" "$TAG-heavy-$r" 120
  DEVICES=6  POLL_MS=1000 OUTAGE_AT_S=30 OUTAGE_FOR_S=150 node "$S/measure.mjs" "$TAG-outage-$r" 240
  LOG_LEVEL=debug DEVICES=6 POLL_MS=1000 node "$S/measure.mjs" "$TAG-debug-$r" 90
done
