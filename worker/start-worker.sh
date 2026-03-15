#!/usr/bin/env bash
set -euo pipefail

Xvfb "${DISPLAY:-:99}" -screen 0 1440x960x24 &
XVFB_PID=$!

pulseaudio --daemonize=yes --exit-idle-time=-1

cleanup() {
  kill "$XVFB_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

npm run worker:start

