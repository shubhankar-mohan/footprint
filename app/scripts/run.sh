#!/usr/bin/env bash
# Dev loop: build + assemble + launch, pointing the supervisor at the repo bridge.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/make-app.sh debug
export CCBAR_BRIDGE="$(cd ../bridge && pwd)/server.js"
open Footprint.app
echo "launched — look for the footprint in your menu bar."
