#!/bin/sh
# Regenerates plugins/draw-diagram/skills/draw-diagram/scripts/lib/engine/silicon from tools/port/silicon:
# the transpiled modules plus the data files they read. Run from anywhere.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
src="$here/silicon/silicon_canvas"
out="$root/plugins/draw-diagram/skills/draw-diagram/scripts/lib/engine/silicon"
python3 -I "$here/transpile.py" "$src" "$out" $(cat "$here/modules.txt")
cp "$src/catalog.json" "$out/catalog.json"
rm -rf "$out/reference_images"
cp -R "$src/reference_images" "$out/reference_images"
cp "$here/silicon/LICENSE" "$out/LICENSE"
