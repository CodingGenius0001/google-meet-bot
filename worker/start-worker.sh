#!/usr/bin/env bash
set -euo pipefail

DISPLAY_TARGET="${DISPLAY:-:99}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-node}"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

echo "Starting Xvfb on $DISPLAY_TARGET"
Xvfb "$DISPLAY_TARGET" -screen 0 1440x960x24 &
XVFB_PID=$!

cleanup() {
  kill "$XVFB_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

if pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=stderr; then
  export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
  echo "PulseAudio started."
else
  export WORKER_DISABLE_RECORDING=true
  echo "PulseAudio failed to start. Continuing without local recording."
fi

exec node dist/worker/src/index.js
