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
RECORDING_WIDTH="${RECORDING_WIDTH:-1920}"
RECORDING_HEIGHT="${RECORDING_HEIGHT:-1080}"
# 20 fps is the lowest framerate where screen text stays readable during
# cursor movement and scroll. 15 was too choppy for reading presented
# content.
RECORDING_FRAMERATE="${RECORDING_FRAMERATE:-20}"
RECORDING_PRESET="${RECORDING_PRESET:-veryfast}"
# CRF 23 is the libx264 default "visually lossless for screen content".
# CRF 28 (previous default) blurs text to the point of unreadability.
RECORDING_CRF="${RECORDING_CRF:-23}"
RECORDING_AUDIO_BITRATE="${RECORDING_AUDIO_BITRATE:-96k}"

# `exec` replaces this bash process with ffmpeg so that SIGINT from the
# parent Node process goes directly to ffmpeg. Without `exec`, bash is
# the signal target and ffmpeg may never see SIGINT, which means it
# never writes the MP4 moov atom and the resulting file is unplayable.
#
# `+frag_keyframe+empty_moov+default_base_moof` writes a fragmented MP4.
# Fragmented MP4 is playable at every keyframe boundary even if ffmpeg
# is killed hard, which is belt-and-suspenders against the same bug.
# `+faststart` requires a clean shutdown to relocate the moov atom and
# is therefore a poor fit for recordings that may be interrupted.
exec ffmpeg -hide_banner -nostats -loglevel warning -y \
  -thread_queue_size 1024 \
  -video_size "${RECORDING_WIDTH}x${RECORDING_HEIGHT}" \
  -framerate "$RECORDING_FRAMERATE" \
  -f x11grab \
  -i "$DISPLAY_TARGET" \
  -thread_queue_size 1024 \
  -f pulse \
  -i "$PULSE_TARGET" \
  -c:v libx264 \
  -preset "$RECORDING_PRESET" \
  -crf "$RECORDING_CRF" \
  -tune zerolatency \
  -pix_fmt yuv420p \
  -movflags +frag_keyframe+empty_moov+default_base_moof \
  -c:a aac \
  -b:a "$RECORDING_AUDIO_BITRATE" \
  -ac 1 \
  "$OUTPUT_PATH"

