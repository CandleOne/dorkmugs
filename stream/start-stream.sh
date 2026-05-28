#!/usr/bin/env bash
# start-stream.sh — launch Xvfb + the Node.js streamer, auto-restart on crash
set -euo pipefail

# ─── Configurable defaults (can be overridden from the environment) ────────────
DISPLAY_NUM="${DISPLAY_NUM:-99}"
SCREEN_RES="${SCREEN_RES:-1280x720x24}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${LOG_FILE:-/var/log/webcam-stream.log}"
RESTART_DELAY_S="${RESTART_DELAY_S:-5}"
NODE_BIN="${NODE_BIN:-node}"

export DISPLAY=":${DISPLAY_NUM}"

# ─── Logging helper ───────────────────────────────────────────────────────────
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

log() {
  local msg="[$(ts)] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

# ─── Ensure log file is writable ──────────────────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || {
  # Fallback to a local log if /var/log isn't writable
  LOG_FILE="${SCRIPT_DIR}/stream.log"
  touch "$LOG_FILE"
}

log "==========================================="
log "webcam-stream  start-stream.sh"
log "  DISPLAY      : $DISPLAY"
log "  SCRIPT_DIR   : $SCRIPT_DIR"
log "  LOG_FILE     : $LOG_FILE"
log "==========================================="

# ─── Start Xvfb if not already running ───────────────────────────────────────
start_xvfb() {
  if pgrep -x Xvfb > /dev/null 2>&1; then
    log "Xvfb already running on $DISPLAY — skipping launch"
    return 0
  fi

  if ! command -v Xvfb > /dev/null 2>&1; then
    log "WARNING: Xvfb not found. Skipping virtual display (assuming real display or CI)."
    return 0
  fi

  log "Starting Xvfb on $DISPLAY (${SCREEN_RES})"
  Xvfb "$DISPLAY" -screen 0 "$SCREEN_RES" -ac +extension GLX +render -noreset &
  XVFB_PID=$!
  sleep 1

  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    log "ERROR: Xvfb failed to start"
    return 1
  fi

  log "Xvfb started (PID ${XVFB_PID})"
}

# ─── Cleanup on exit ─────────────────────────────────────────────────────────
cleanup() {
  log "Caught exit signal — cleaning up"
  # Kill background Xvfb if we started it
  if [[ -n "${XVFB_PID:-}" ]]; then
    kill "$XVFB_PID" 2>/dev/null || true
    log "Xvfb (PID $XVFB_PID) stopped"
  fi
}
trap cleanup EXIT SIGINT SIGTERM

XVFB_PID=""
start_xvfb

# ─── Main restart loop ────────────────────────────────────────────────────────
ATTEMPT=0
while true; do
  ATTEMPT=$((ATTEMPT + 1))
  log "Attempt ${ATTEMPT}: launching streamer"

  (
    cd "$SCRIPT_DIR"
    exec "$NODE_BIN" stream.js
  ) 2>&1 | while IFS= read -r line; do
    # Prefix raw stdout with a timestamp and tee to log
    echo "$line"
    echo "[$( ts)] $line" >> "$LOG_FILE" 2>/dev/null || true
  done || true

  EXIT_CODE=${PIPESTATUS[0]}
  log "Streamer exited (code ${EXIT_CODE}). Restarting in ${RESTART_DELAY_S}s…"
  sleep "$RESTART_DELAY_S"
done
