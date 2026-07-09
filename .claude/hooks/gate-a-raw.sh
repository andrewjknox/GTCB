#!/usr/bin/env bash
# Gate A — validates data/raw/*.json via scripts/gates/gate-a.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
node scripts/gates/gate-a.mjs
exit $?
