#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo
require_implemented raft1 "Lab 3"

# Raft is split into 3A–3D because the full suite takes ~10 minutes under -race.
if quick; then
  run_make_tests raft1 RUN="-run 3A"
else
  run_make_tests raft1 RUN="-run 3A"
  run_make_tests raft1 RUN="-run 3B"
  run_make_tests raft1 RUN="-run 3C"
  run_make_tests raft1 RUN="-run 3D"
fi

finish
