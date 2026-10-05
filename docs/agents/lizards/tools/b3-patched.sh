#!/bin/sh
# B3: runs tests/larva.test.mjs against a scratch copy of src with reports/B3.hunk.patch applied (animals.js is locked and queued).
# The copy (docs/agents/lizards/tools/tmp/src) is scratch: never commit it.   sh docs/agents/lizards/tools/b3-patched.sh
set -e
cd "$(dirname "$0")/../../../.."
T=docs/agents/lizards/tools/tmp
rm -rf "$T/src" && mkdir -p "$T" && cp -R src "$T/src"
patch -s -p1 -d "$T" < docs/agents/lizards/reports/B3.hunk.patch
LARVA_SRC="$T/src" node --test tests/larva.test.mjs
