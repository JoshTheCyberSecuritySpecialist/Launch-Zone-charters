"""
Clean header logo PNG: full alpha, no garbage RGB in transparent areas,
gentle alpha feather only (does not blur RGB / logo detail).
Overwrites the source file in public/images/.

Run: python scripts/clean_rocket_logo_png.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
REL = "public/images/rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png"
PATH = ROOT / REL


def main() -> None:
    if not PATH.is_file():
        raise SystemExit(f"Missing: {PATH}")

    im = Image.open(PATH).convert("RGBA")
    w, h = im.size
    px = im.load()

    # Pass 1: clear RGB wherever alpha is 0 (true PNG-32 housekeeping)
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                px[x, y] = (0, 0, 0, 0)

    # Pass 2: crush near-invisible alpha noise (compression speckle)
    noise_threshold = 6
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if 0 < a <= noise_threshold:
                px[x, y] = (0, 0, 0, 0)

    # Pass 3: alpha-only feather (≈0.5px); RGB unchanged — smooths matte fringe
    r, g, b, a = im.split()
    a2 = a.filter(ImageFilter.GaussianBlur(radius=0.5))
    # Re-crush fully transparent after blur
    a2 = a2.point(lambda v: 0 if v < 4 else v)
    out = Image.merge("RGBA", (r, g, b, a2))

    # Pass 4: final housekeeping — zero RGB under fully transparent
    px2 = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px2[x, y]
            if a == 0:
                px2[x, y] = (0, 0, 0, 0)

    out.save(PATH, format="PNG", compress_level=6, optimize=True)
    print(f"Wrote {PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
