#!/usr/bin/env bash
# Gate B — validates data/summary/*.json via scripts/gates/gate-b.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
node scripts/gates/gate-b.mjs
exit $?
