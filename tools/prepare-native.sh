#!/usr/bin/env bash
# Bundles the shared preview engine (with the offline React and Tailwind builds) for Android and Kotlin/Wasm.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p multiplatform/composeApp/src/androidMain/assets/engine multiplatform/composeApp/src/wasmJsMain/resources multiplatform/.generated
npx esbuild src/native-host.ts --bundle --format=iife --target=es2020 --minify --outfile=multiplatform/composeApp/src/androidMain/assets/engine/engine.js
npx esbuild src/wasm-host.ts --bundle --format=iife --target=es2020 --minify --outfile=multiplatform/composeApp/src/wasmJsMain/resources/host.js
cp src/app/icon.svg multiplatform/composeApp/src/wasmJsMain/resources/icon.svg
npx esbuild tools/export-demos.ts --bundle --platform=node --format=cjs --outfile=multiplatform/.generated/export-demos.cjs
node multiplatform/.generated/export-demos.cjs
rm -rf multiplatform/.generated
