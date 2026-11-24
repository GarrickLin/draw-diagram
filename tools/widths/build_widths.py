"""Builds data/widths.json: advance widths of Liberation Sans (Helvetica metrics) in 1/1000 em.

draw.io draws western text in Helvetica, which browsers and Desktop replace with Arial or
Liberation Sans; the three share advance widths. The skill sizes boxes and wraps labels with this
table, both in Node (lib/text-width.js) and in the Python layout engine (silicon.patch), so the two
measure the same.

    ~/.cache/draw-diagram/venv/bin/python -I tools/widths/build_widths.py <fonts-dir> <out.json>

<fonts-dir> holds LiberationSans-Regular.ttf and LiberationSans-Bold.ttf.

The ASCII range is checked against the Helvetica table in draw.io's
shared/semantic/text-width.js: a difference over 1 unit stops the build, since the two tables
would then disagree about the same label.
"""

import json
import re
import sys
from pathlib import Path

from PIL import ImageFont

UPM = 1000

# Characters beyond ASCII that technical labels use. Anything outside this list and outside the
# wide (CJK) ranges falls back to the width of "n" in lib/text-width.js, as draw.io's table does.
EXTRA_RANGES = [
    (0x00A0, 0x00FF),  # Latin-1: µ ° ± × ÷ ² ³ ¹ · and accented letters
    (0x0100, 0x017F),  # Latin Extended-A
    (0x0391, 0x03A9),  # Greek capitals
    (0x03B1, 0x03C9),  # Greek small
    (0x2010, 0x2027),  # dashes, quotes, bullet, ellipsis
    (0x2030, 0x203A),  # per mille, primes, angle quotes
    (0x2070, 0x209C),  # superscripts and subscripts
    (0x20AC, 0x20AC),  # euro
    (0x2100, 0x2135),  # letterlike: ℃ ℓ № ™ Ω ℵ
    (0x2190, 0x21FF),  # arrows
    (0x2200, 0x22FF),  # mathematical operators
    (0x2300, 0x23FF),  # technical: ⌈ ⌉ ⌊ ⌋
    (0x25A0, 0x25FF),  # geometric shapes
    (0x1D00, 0x1DBF),  # phonetic extensions: modifier letters such as ᵀ ᵢ
]


# A private-use character no Liberation font has: what the font draws for any missing character.
NOTDEF = "\ue000"


def advances(path):
    face = ImageFont.truetype(str(path), UPM, layout_engine=ImageFont.Layout.BASIC)

    def width(ch):
        return round(face.getlength(ch))

    return face, width


def is_notdef(face, ch):
    """Whether `ch` is drawn as the .notdef glyph: same advance and same ink as NOTDEF."""
    if round(face.getlength(ch)) != round(face.getlength(NOTDEF)):
        return False
    a, b = face.getmask(ch), face.getmask(NOTDEF)
    return a.size == b.size and bytes(a) == bytes(b)


def helvetica_table(text_width_js):
    src = Path(text_width_js).read_text(encoding="utf-8")
    tables = {}
    for name in ("REGULAR", "BOLD"):
        body = re.search(rf"const {name} = \[(.*?)\];", src, re.S).group(1)
        tables[name] = [int(x) for x in re.findall(r"\d+", body)]
    return tables


def build(fonts_dir, text_width_js):
    out = {"unitsPerEm": UPM, "fallback": "n", "wideEm": 1.0}
    reference = helvetica_table(text_width_js)
    for style, file, ref in (("regular", "LiberationSans-Regular.ttf", "REGULAR"),
                             ("bold", "LiberationSans-Bold.ttf", "BOLD")):
        face, width = advances(Path(fonts_dir) / file)
        missing = width("")
        ascii_widths = [width(chr(c)) for c in range(32, 127)]
        diffs = [(chr(32 + i), a, b) for i, (a, b) in enumerate(zip(ascii_widths, reference[ref])) if abs(a - b) > 1]
        if diffs:
            raise SystemExit(f"{style}: Liberation Sans and draw.io's Helvetica table differ: {diffs[:8]}")
        extra = {}
        for lo, hi in EXTRA_RANGES:
            for code in range(lo, hi + 1):
                ch = chr(code)
                # Keep only characters the font really has.
                if is_notdef(face, ch):
                    continue
                extra[ch] = width(ch)
        out[style] = {"ascii": reference[ref], "extra": extra}
    return out


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    fonts_dir, text_width_js, out_path = sys.argv[1:]
    table = build(fonts_dir, text_width_js)
    Path(out_path).write_text(json.dumps(table, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
                              encoding="utf-8")
    print(f"{out_path}: {len(table['regular']['extra'])} extra regular, {len(table['bold']['extra'])} extra bold")


if __name__ == "__main__":
    main()
