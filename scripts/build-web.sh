#!/usr/bin/env sh
# Build the engine for the browser and make a static replica of this repository to clone from.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
sh "$root/scripts/build-engine.sh"
(cd "$root" && sha256sum -c scripts/kernel.sha256)
node "$root/scripts/shell-manifest.mjs"
rm -rf "$root/web/fixtures/holo-git.git"
mkdir -p "$root/web/fixtures"
git clone -q --bare "$root" "$root/web/fixtures/holo-git.git"
git -C "$root/web/fixtures/holo-git.git" repack -a -d -q
git -C "$root/web/fixtures/holo-git.git" update-server-info
echo "replica: web/fixtures/holo-git.git"
