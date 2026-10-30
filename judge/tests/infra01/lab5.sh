#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo
require_implemented shardkv1 "Lab 5"

if quick; then
  run_make_tests shardkv RUN="-run 5A"
else
  run_make_tests shardkv RUN="-run 5A"
  run_make_tests shardkv RUN="-run 5B"
  run_make_tests shardkv RUN="-run 5C"
fi

finish
