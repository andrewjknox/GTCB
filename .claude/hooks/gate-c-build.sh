#!/usr/bin/env bash
# Gate C — validates site/ via scripts/gates/gate-c.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
node scripts/gates/gate-c.mjs
exit $?
