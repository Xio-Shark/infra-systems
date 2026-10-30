#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo
require_implemented kvraft1 "Lab 4"

if quick; then
  run_make_tests rsm1 RUN="-run 4A"
  run_make_tests kvraft1 RUN="-run 4B"
else
  run_make_tests rsm1 RUN="-run 4A"
  run_make_tests kvraft1 RUN="-run 4B"
  run_make_tests kvraft1 RUN="-run 4C"
fi

finish
