#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="$1"
DISPLAY_TARGET="${DISPLAY:-:99}"
PULSE_TARGET="${PULSE_SOURCE:-default}"

ffmpeg -y \
  -video_size 1440x960 \
  -framerate 24 \
  -f x11grab \
  -i "$DISPLAY_TARGET" \
  -f pulse \
  -i "$PULSE_TARGET" \
  -c:v libx264 \
  -preset ultrafast \
  -pix_fmt yuv420p \
  -c:a aac \
  "$OUTPUT_PATH"

