#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.worker}"
IMAGE_NAME="${IMAGE_NAME:-google-meet-bot-worker}"
CONTAINER_NAME="${CONTAINER_NAME:-google-meet-bot-worker}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Worker env file not found at $ENV_FILE"
  echo "Copy deploy/oracle/.env.worker.example to deploy/oracle/.env.worker and fill it in first."
  exit 1
fi

docker build -f "$REPO_ROOT/worker/Dockerfile" -t "$IMAGE_NAME" "$REPO_ROOT"

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -p 127.0.0.1:8080:8080 \
  "$IMAGE_NAME"

docker ps --filter "name=$CONTAINER_NAME"
