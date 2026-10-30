#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

require_repo
require_implemented mr "Lab 1"

if quick; then
  run_make_tests mr RUN="-run Wc"
else
  run_make_tests mr
fi

finish
