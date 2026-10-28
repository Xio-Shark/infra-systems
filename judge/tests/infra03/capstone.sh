#!/usr/bin/env bash
# Placeholder: INFRA 03 interfaces are not frozen; acceptance is manual.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/../common.sh"
skip_all "Capstone" "manual acceptance; interface not frozen (see content/agent-os.md#lab-aos-capstone)"
