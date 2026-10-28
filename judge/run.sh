#!/usr/bin/env bash
set -euo pipefail

# The judge changes into the course repo so its test scripts are found.
# Resolve user-supplied paths against the caller's cwd first; otherwise
# `SUBMISSION=./cn1` would be looked up inside the course repo.
for name in SUBMISSION CN1_ROOTFS LAB_ROOT; do
  value="${!name-}"
  [ -n "$value" ] || continue
  case "$value" in
    /*) ;;
    *) export "$name=$PWD/$value" ;;
  esac
done

cd "$(dirname "$0")/.."
exec python3 judge/judge.py "$@"
