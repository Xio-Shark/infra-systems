#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo

if quick; then
  run_check "3A election" make -C "$SRC" RUN="-run 3A" raft1
else
  run_check "3A election" make -C "$SRC" RUN="-run 3A" raft1
  run_check "3B log replication" make -C "$SRC" RUN="-run 3B" raft1
  run_check "3C persistence" make -C "$SRC" RUN="-run 3C" raft1
  run_check "3D snapshot" make -C "$SRC" RUN="-run 3D" raft1
fi

finish
