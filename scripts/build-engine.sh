#!/usr/bin/env sh
# Build the engine for the browser and put it where the page and its tests load it from.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
# The binary must not depend on where it was built: other checks are keyed by its bytes, and a
# path baked into it would make every machine's build a different product.
RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$root=/holo-git --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
export RUSTFLAGS
(cd "$root/engine" && cargo build --release --target wasm32-unknown-unknown)
mkdir -p "$root/web"
cp "$root/engine/target/wasm32-unknown-unknown/release/holo_git_engine.wasm" "$root/web/engine.wasm"
echo "engine: $(wc -c < "$root/web/engine.wasm") bytes"
