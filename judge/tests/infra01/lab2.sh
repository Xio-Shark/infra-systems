#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo

if quick; then
  run_check "kvsrv1 reliable" make -C "$SRC" RUN="-run Reliable" kvsrv1
  run_check "lock reliable" make -C "$SRC" RUN="-run Reliable" lock1
else
  run_check "kvsrv1" make -C "$SRC" kvsrv1
  run_check "lock1" make -C "$SRC" lock1
fi

finish
