#!/usr/bin/env bash
# Gate D — validates the newest data/review/*.json via scripts/gates/gate-d.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
node scripts/gates/gate-d.mjs
exit $?
