#!/usr/bin/env sh
# Build the engine for the browser and put it where the page and its tests load it from.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root/engine" && cargo build --release --target wasm32-unknown-unknown)
cp "$root/engine/target/wasm32-unknown-unknown/release/holo_git_engine.wasm" "$root/web/engine.wasm"
echo "engine: $(wc -c < "$root/web/engine.wasm") bytes"
