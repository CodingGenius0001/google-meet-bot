#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="$1"
DISPLAY_TARGET="${DISPLAY:-:99}"
PULSE_TARGET="${PULSE_SOURCE:-default}"

# Tunable recording quality knobs. Defaults are chosen for the smallest file
# size that still produces a legible Google Meet recording (mostly static
# screen content with voice audio). Override via env if you need higher
# fidelity.
#
#   RECORDING_WIDTH / RECORDING_HEIGHT — capture resolution. Must match the
#     virtual display Xvfb was started with, otherwise x11grab will error.
#   RECORDING_FRAMERATE — frames per second. 10–15 is plenty for a meeting.
#   RECORDING_PRESET — libx264 preset. Slower presets compress better.
#   RECORDING_CRF — Constant Rate Factor. Higher = smaller + lower quality.
#     23 is libx264 default, 28 is "visibly lossy but fine for a call",
#     30 is about as high as you want to push it.
#   RECORDING_AUDIO_BITRATE — AAC bitrate. 64k mono is fine for speech.
RECORDING_WIDTH="${RECORDING_WIDTH:-1280}"
RECORDING_HEIGHT="${RECORDING_HEIGHT:-720}"
RECORDING_FRAMERATE="${RECORDING_FRAMERATE:-15}"
RECORDING_PRESET="${RECORDING_PRESET:-veryfast}"
RECORDING_CRF="${RECORDING_CRF:-28}"
RECORDING_AUDIO_BITRATE="${RECORDING_AUDIO_BITRATE:-64k}"

ffmpeg -hide_banner -nostats -loglevel warning -y \
  -video_size "${RECORDING_WIDTH}x${RECORDING_HEIGHT}" \
  -framerate "$RECORDING_FRAMERATE" \
  -f x11grab \
  -i "$DISPLAY_TARGET" \
  -f pulse \
  -i "$PULSE_TARGET" \
  -c:v libx264 \
  -preset "$RECORDING_PRESET" \
  -crf "$RECORDING_CRF" \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -c:a aac \
  -b:a "$RECORDING_AUDIO_BITRATE" \
  -ac 1 \
  "$OUTPUT_PATH"

