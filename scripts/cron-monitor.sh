#!/usr/bin/env bash
# Wrapper for cron-monitor.py (runs every 6 hours at :15).
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cron-lib.sh"

acquire_lock "monitor"
load_env

run_low_prio "$PYTHON_BIN" "$ROOT_DIR/scripts/cron-monitor.py" "$@"
