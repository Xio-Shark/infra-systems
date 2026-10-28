#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo

if quick; then
  run_check "make mr (Wc)" make -C "$SRC" RUN="-run Wc" mr
else
  run_check "make mr" make -C "$SRC" mr
fi

finish
