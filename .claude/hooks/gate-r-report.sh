#!/usr/bin/env bash
# Gate R — validates data/reports/*.json via scripts/gates/gate-r.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
node scripts/gates/gate-r.mjs
exit $?
