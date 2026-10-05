# /// script
# requires-python = ">=3.9"
# dependencies = ["fonttools>=4.50", "skia-pathops>=0.8"]
# ///
"""Build fonts/HerdrUsageIcons.otf from assets/*.svg.

Each logo becomes one single-color glyph in the Unicode Private Use Area. All
paths of a logo are combined with the even-odd rule, so a filled shape on top of
a background is cut out of it (the Codex cloud out of its tile). Adapted from
adihex/herdr-agent-icons (MIT).

Run:  uv run tools/build-font.py
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
UPM = 1000
FAMILY = "HerdrUsageIcons"
# glyph name -> (source SVG, codepoint). Keep in sync with ICONS in src/herdr.js.
# Top of plane 16, away from other icon fonts that count up from U+100000.
GLYPHS = {
    "claude": ("claude-code.svg", 0x10FFE1),
    "codex": ("codex.svg", 0x10FFE2),
}


def svg_to_glyph(svg_path):
    root = ET.parse(svg_path).getroot()
    vx, vy, vw, vh = map(float, re.findall(r"-?\d*\.?\d+", root.attrib["viewBox"]))
    s = UPM / max(vw, vh)
    paths = [el.attrib["d"] for el in root.iter() if el.tag.rsplit("}", 1)[-1] == "path"]
    if not paths:
        raise SystemExit(f"{svg_path}: no <path>")
    shape = pathops.Path(fillType=pathops.FillType.EVEN_ODD)
    # SVG y grows down, font y grows up.
    pen = TransformPen(shape.getPen(), Transform(s, 0, 0, -s, -vx * s, (vy + vh) * s))
    for d in paths:
        parse_path(d, pen)
    # Resolve the even-odd overlaps into clean contours that any rasterizer
    # (non-zero winding) fills the same way.
    shape.simplify(fix_winding=True)
    out = T2CharStringPen(UPM, None)
    shape.draw(out)
    return out.getCharString()


def main():
    names = [".notdef", *GLYPHS]
    charstrings = {".notdef": T2CharStringPen(UPM, None).getCharString()}
    for name, (svg, _) in GLYPHS.items():
        charstrings[name] = svg_to_glyph(ROOT / "assets" / svg)

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: name for name, (_, cp) in GLYPHS.items()})
    fb.setupCFF(f"{FAMILY}-Regular", {"FullName": f"{FAMILY} Regular", "FamilyName": FAMILY}, charstrings, {})
    fb.setupHorizontalMetrics({n: (UPM, 0) for n in names})
    fb.setupHorizontalHeader(ascent=UPM, descent=0)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{FAMILY} Regular",
        "fullName": f"{FAMILY} Regular",
        "psName": f"{FAMILY}-Regular",
        "version": "Version 2.0",
    })
    fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
    fb.setupPost()
    out = ROOT / "fonts" / f"{FAMILY}.otf"
    out.parent.mkdir(exist_ok=True)
    fb.save(out)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
