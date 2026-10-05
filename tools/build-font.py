# /// script
# requires-python = ">=3.9"
# dependencies = ["fonttools>=4.50", "skia-pathops>=0.8"]
# ///
"""Build fonts/HerdrUsageIcons.ttf from assets/*.svg.

Each logo becomes one single-color glyph in the Unicode Private Use Area. All
paths of a logo, except a white background, are combined with the even-odd rule,
so inner shapes become holes. TrueType outlines, because
DirectWrite (Windows Terminal) handles them more reliably than CFF. Adapted from
adihex/herdr-agent-icons (MIT).

Run:  uv run tools/build-font.py
"""
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parent.parent
UPM = 1000
LOGO_SIZE = UPM * 18 / 24
FAMILY = "HerdrUsageIcons"
WHITE = {"#fff", "#ffffff", "white"}
# provider id -> {svg, codepoint}; src/herdr.js reads the same file. Codepoints
# sit at the top of plane 16, away from icon fonts that count up from U+100000.
# Never renumber one: installed fonts and published tokens would disagree.
GLYPHS = {
    name: (icon["svg"], int(icon["codepoint"], 16))
    for name, icon in json.loads((ROOT / "assets" / "icons.json").read_text(encoding="utf8")).items()
}


def svg_to_glyph(svg_path):
    root = ET.parse(svg_path).getroot()
    vx, vy, vw, vh = map(float, re.findall(r"-?\d*\.?\d+", root.attrib["viewBox"]))
    s = UPM / max(vw, vh)
    # A white path is a separate background (like the Codex app tile): leave it out.
    paths = [
        el.attrib["d"]
        for el in root.iter()
        if el.tag.rsplit("}", 1)[-1] == "path" and el.attrib.get("fill", "").lower() not in WHITE
    ]
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
    # Fit the drawn shape, not the SVG's viewBox, into the same centered box,
    # so every logo has the same size and position. The box keeps the padding of
    # the 24-unit icon sets (3 units on each side).
    x0, y0, x1, y1 = shape.bounds
    k = LOGO_SIZE / max(x1 - x0, y1 - y0)
    fit = Transform().translate(UPM / 2, UPM / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
    out = TTGlyphPen(None)
    # TrueType wants quadratic curves and clockwise outer contours.
    shape.draw(TransformPen(Cu2QuPen(out, max_err=1, reverse_direction=True), fit))
    return out.glyph()


def main():
    # A space keeps the BMP cmap subtable non-empty.
    names = [".notdef", "space", *GLYPHS]
    glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
    for name, (svg, _) in GLYPHS.items():
        glyphs[name] = svg_to_glyph(ROOT / "assets" / svg)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({0x20: "space", **{cp: name for name, (_, cp) in GLYPHS.items()}})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({n: (UPM, glyphs[n].xMin if hasattr(glyphs[n], "xMin") else 0) for n in names})
    fb.setupHorizontalHeader(ascent=UPM, descent=0)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{FAMILY} Regular",
        "fullName": f"{FAMILY} Regular",
        "psName": f"{FAMILY}-Regular",
        "version": "Version 3.0",
    })
    # ulUnicodeRange bit 90: Supplementary Private Use Area planes 15/16.
    fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0,
                usWeightClass=400, ulUnicodeRange3=1 << (90 - 64), ulCodePageRange1=1)
    fb.setupPost()
    out = ROOT / "fonts" / f"{FAMILY}.ttf"
    out.parent.mkdir(exist_ok=True)
    # Fixed timestamps: the same sources give the same bytes, so the hashed file
    # name that install-font uses only changes when a logo changes.
    fb.font["head"].created = fb.font["head"].modified = 0
    fb.font.recalcTimestamp = False
    fb.save(out)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
