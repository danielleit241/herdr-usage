# /// script
# requires-python = ">=3.9"
# dependencies = ["fonttools>=4.50"]
# ///
"""Build fonts/HerdrUsageIcons.otf from assets/{claude,codex}.svg.

Each logo becomes one glyph at the same Private Use codepoint that
adihex/herdr-agent-icons (MIT) uses, so either font draws the same logo.
Adapted from that project's tools/build-font.py.

Run:  uv run tools/build-font.py
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
UPM = 1000
FAMILY = "HerdrUsageIcons"
# Keep in sync with ICONS in src/herdr.js.
GLYPHS = {"claude": 0x100001, "codex": 0x100003}


def svg_to_glyph(svg_path):
    """Draw every <path> of a single-color SVG into one glyph scaled to the UPM box."""
    root = ET.parse(svg_path).getroot()
    vx, vy, vw, vh = map(float, re.findall(r"-?\d*\.?\d+", root.attrib["viewBox"]))
    s = UPM / max(vw, vh)
    # SVG y grows down, font y grows up.
    pen = T2CharStringPen(UPM, None)
    tpen = TransformPen(pen, Transform(s, 0, 0, -s, -vx * s, (vy + vh) * s))
    paths = [el.attrib["d"] for el in root.iter() if el.tag.rsplit("}", 1)[-1] == "path"]
    if not paths:
        raise SystemExit(f"{svg_path}: no <path>")
    for d in paths:
        parse_path(d, tpen)
    return pen.getCharString()


def main():
    names = [".notdef", *GLYPHS]
    charstrings = {".notdef": T2CharStringPen(UPM, None).getCharString()}
    for name in GLYPHS:
        charstrings[name] = svg_to_glyph(ROOT / "assets" / f"{name}.svg")

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: name for name, cp in GLYPHS.items()})
    fb.setupCFF(f"{FAMILY}-Regular", {"FullName": f"{FAMILY} Regular", "FamilyName": FAMILY}, charstrings, {})
    fb.setupHorizontalMetrics({n: (UPM, 0) for n in names})
    fb.setupHorizontalHeader(ascent=UPM, descent=0)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{FAMILY} Regular",
        "fullName": f"{FAMILY} Regular",
        "psName": f"{FAMILY}-Regular",
        "version": "Version 1.0",
    })
    fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
    fb.setupPost()
    out = ROOT / "fonts" / f"{FAMILY}.otf"
    out.parent.mkdir(exist_ok=True)
    fb.save(out)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
