#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo

if quick; then
  run_check "5A shards" make -C "$SRC" RUN="-run 5A" shardkv
else
  run_check "5A shards" make -C "$SRC" RUN="-run 5A" shardkv
  run_check "5B controller recovery" make -C "$SRC" RUN="-run 5B" shardkv
  run_check "5C concurrent config" make -C "$SRC" RUN="-run 5C" shardkv
fi

finish
