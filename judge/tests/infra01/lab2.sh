#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo
require_implemented kvsrv1 "Lab 2"

if quick; then
  run_make_tests kvsrv1 RUN="-run Reliable"
  run_make_tests lock1 RUN="-run Reliable"
else
  run_make_tests kvsrv1
  run_make_tests lock1
fi

finish
