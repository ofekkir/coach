#!/usr/bin/env python3
"""Stitch decorated workflow-diagram PNGs into one titled atlas page.

Usage:
    build-atlas.py OUT.png "Section title:diagram1.png" "Another:diagram2.png" ...

Each arg after OUT is "SECTION HEADER:path-to-png". Sections stack vertically,
each under a blue header band. Requires Pillow.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

TITLE = "agent workflow atlas"
SUBTITLE = "nodes decorated with  times | minutes | output-tokens  and pass/fail branch rates"


def font(sz, bold=True):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else
              "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    out = sys.argv[1]
    sections = [a.split(":", 1) for a in sys.argv[2:]]
    imgs = [(title, Image.open(path).convert("RGB")) for title, path in sections]

    W = max(im.width for _, im in imgs)
    scaled = []
    for title, im in imgs:
        if im.width != W:
            im = im.resize((W, int(im.height * W / im.width)), Image.LANCZOS)
        scaled.append((title, im))

    TITLE_H, SEC_H, PAD, MARGIN = 150, 90, 60, 50
    total = TITLE_H + sum(SEC_H + im.height + PAD for _, im in scaled) + MARGIN
    canvas = Image.new("RGB", (W + 2 * MARGIN, total), "white")
    d = ImageDraw.Draw(canvas)
    d.text((MARGIN, 30), TITLE, font=font(64), fill="#111")
    d.text((MARGIN, 105), SUBTITLE, font=font(28, bold=False), fill="#555")

    y = TITLE_H
    for title, im in scaled:
        d.rectangle([MARGIN, y, MARGIN + W, y + SEC_H - 20], fill="#1f4e79")
        d.text((MARGIN + 20, y + 14), title, font=font(44), fill="white")
        y += SEC_H
        canvas.paste(im, (MARGIN, y))
        y += im.height + PAD

    canvas.save(out)
    print(f"atlas: {out} {canvas.size}")


if __name__ == "__main__":
    main()
