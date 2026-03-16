#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script expects Ubuntu or Debian with apt-get."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y docker.io git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "Docker is installed."
echo "Sign out and back in once so your shell picks up the docker group."
