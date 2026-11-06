#!/usr/bin/env bash
# Bundles the preview engine for Android and Kotlin/Wasm.
# The engine source lives in multiplatform/engine; this is a convenience wrapper.
set -euo pipefail
cd "$(dirname "$0")/../multiplatform/engine"
npm ci --no-audit --no-fund
npm test
npm run build
