#!/usr/bin/env bash
set -euo pipefail

DISPLAY_TARGET="${DISPLAY:-:99}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-node}"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Keep the virtual display in sync with the recording capture size so that
# x11grab captures the full Chromium window (see scripts/start-recording.sh).
RECORDING_WIDTH="${RECORDING_WIDTH:-1280}"
RECORDING_HEIGHT="${RECORDING_HEIGHT:-720}"
export RECORDING_WIDTH RECORDING_HEIGHT

echo "Starting Xvfb on $DISPLAY_TARGET at ${RECORDING_WIDTH}x${RECORDING_HEIGHT}"
Xvfb "$DISPLAY_TARGET" -screen 0 "${RECORDING_WIDTH}x${RECORDING_HEIGHT}x24" &
XVFB_PID=$!

cleanup() {
  kill "$XVFB_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

# Park the X cursor in the bottom-right corner so it doesn't sit in
# the middle of every recording. Playwright's page.mouse dispatches
# CDP synthetic events, not X events, so nothing else moves the real
# X cursor afterward — one call is enough for the whole session. The
# retry loop handles Xvfb's brief warmup where it isn't yet accepting
# X clients.
for _ in 1 2 3 4 5; do
  if DISPLAY="$DISPLAY_TARGET" xdotool mousemove "$((RECORDING_WIDTH - 1))" "$((RECORDING_HEIGHT - 1))" 2>/dev/null; then
    echo "Parked X cursor at bottom-right corner."
    break
  fi
  sleep 0.2
done

if pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=stderr; then
  export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
  echo "PulseAudio started."
else
  export WORKER_DISABLE_RECORDING=true
  echo "PulseAudio failed to start. Continuing without local recording."
fi

exec node dist/worker/src/index.js
