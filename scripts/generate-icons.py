#!/usr/bin/env python3
"""Generate Dicefall app icons: PWA (192/512), Android legacy launcher
(density buckets), Android adaptive foreground, and splash art.

Run from repo root:  python3 scripts/generate-icons.py
Output: build-assets/  (gitignored, consumed by the packaging step)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "build-assets")
os.makedirs(OUT, exist_ok=True)

BG = (12, 8, 16)            # #0c0810  (game background)
GREEN = (0, 255, 136)       # #00ff88  (die emissive)
MAGENTA = (255, 47, 214)    # #ff2fd6  (hover emissive)
FACE = (24, 13, 38)         # die face dark purple
EDGE_DARK = (8, 5, 12)      # die depth sides


def _die_art(size, adaptive):
    """Return a PIL image containing the neon die, centered."""
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")

    if not adaptive:
        # soft background glow (two blurred translucent ellipses)
        glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        c = S // 2
        gd.ellipse([c - S * 0.55, c - S * 0.55, c + S * 0.55, c + S * 0.55],
                   fill=(*MAGENTA, 26))
        gd.ellipse([c - S * 0.42, c - S * 0.42, c + S * 0.42, c + S * 0.42],
                   fill=(*GREEN, 24))
        glow = glow.filter(ImageFilter.GaussianBlur(S * 0.14))
        img = Image.alpha_composite(img, glow)
        # rebind draw context AFTER compositing (stale ctx would draw to the
        # discarded pre-composite image)
        d = ImageDraw.Draw(img, "RGBA")

    # die footprint: adaptive keeps art inside the 66% safe zone
    u = S * 0.58 if adaptive else S * 0.62
    cx, cy = S / 2, S / 2 - S * 0.012
    half, depth = u / 2, u * 0.20
    x0, y0, x1, y1 = cx - half, cy - half, cx + half, cy + half

    # 3D depth sides (behind the face)
    d.polygon([(x1, y0 + depth), (x1 + depth, y0 + depth * 1.35),
               (x1 + depth, y1 + depth * 0.35), (x1, y1)], fill=EDGE_DARK)
    d.polygon([(x0, y1), (x1, y1), (x1 + depth, y1 + depth * 0.35),
               (x0 + depth, y1 + depth * 0.35)], fill=EDGE_DARK)

    # face + neon glow edges
    r = u * 0.12
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=FACE)
    for w, col, a in [(u * 0.07, GREEN, 110), (u * 0.04, GREEN, 210),
                      (u * 0.018, (255, 255, 255), 230)]:
        d.rounded_rectangle([x0, y0, x1, y1], radius=r,
                            outline=(*col, a), width=max(2, int(w)))

    # pips: quincunx (5) in magenta with white cores
    pr = u * 0.085
    pts = [(cx - u * 0.27, cy - u * 0.27), (cx + u * 0.27, cy - u * 0.27),
           (cx, cy),
           (cx - u * 0.27, cy + u * 0.27), (cx + u * 0.27, cy + u * 0.27)]
    for px, py in pts:
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=(*MAGENTA, 255))
        d.ellipse([px - pr * 0.55, py - pr * 0.55, px + pr * 0.55,
                   py + pr * 0.55], fill=(255, 255, 255, 235))
    return img


def _full_bleed(size):
    img = Image.new("RGBA", (size, size), (*BG, 255))
    art = _die_art(size, adaptive=False)
    return Image.alpha_composite(img, art)


def main():
    master = _full_bleed(1024)
    master.save(os.path.join(OUT, "icon-master.png"))
    print("icon-master.png (1024)")

    # PWA icons
    for s in (512, 192):
        _full_bleed(s).save(os.path.join(OUT, f"icon-{s}.png"))
        print(f"icon-{s}.png")

    # Android legacy launcher density buckets (square, full-bleed)
    for name, size in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                       ("xxhdpi", 144), ("xxxhdpi", 192)]:
        _full_bleed(size).save(os.path.join(OUT, f"ic_launcher_{name}.png"))
        print(f"ic_launcher_{name}.png ({size})")

    # Android adaptive foreground (transparent, safe-zone art) 432px = 108dp@4x
    _die_art(432, adaptive=True).save(
        os.path.join(OUT, "ic_launcher_foreground.png"))
    print("ic_launcher_foreground.png (432, adaptive)")

    # Splash (2732x2732, big centered die on game background)
    splash = Image.new("RGBA", (2732, 2732), (*BG, 255))
    art = _die_art(2732, adaptive=False)
    splash = Image.alpha_composite(splash, art)
    splash.save(os.path.join(OUT, "splash.png"))
    print("splash.png (2732)")

    print("DONE")


if __name__ == "__main__":
    main()
