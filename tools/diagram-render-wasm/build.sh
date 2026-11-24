#!/bin/sh
# Builds diagram_render.wasm from the pinned diagram-render source plus wasm.patch.
#
#   tools/diagram-render-wasm/build.sh [out-dir]
#
# Needs: git, a Rust toolchain with the wasm32-unknown-unknown target
# (rustup target add wasm32-unknown-unknown). Writes diagram_render.wasm to out-dir
# (default: tools/diagram-render-wasm/dist).
set -eu

REPO=https://github.com/nowmyagentcan/diagram-render
COMMIT=55eb15b2c7ca04abbcb2843967874eca265fc4fa

here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/dist}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -C "$work" init -q src
git -C "$work/src" fetch -q --depth 1 "$REPO" "$COMMIT"
git -C "$work/src" checkout -q FETCH_HEAD
git -C "$work/src" apply "$here/wasm.patch"

(cd "$work/src" && cargo build --locked --lib --release --target wasm32-unknown-unknown)

mkdir -p "$out"
cp "$work/src/target/wasm32-unknown-unknown/release/diagram_render.wasm" "$out/"
echo "$out/diagram_render.wasm"
