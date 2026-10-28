#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo

if quick; then
  run_check "4A RSM" make -C "$SRC" RUN="-run 4A" rsm1
  run_check "4B KV" make -C "$SRC" RUN="-run 4B" kvraft1
else
  run_check "4A RSM" make -C "$SRC" rsm1
  run_check "4B KV" make -C "$SRC" RUN="-run 4B" kvraft1
  run_check "4C snapshot" make -C "$SRC" RUN="-run 4C" kvraft1
fi

finish
