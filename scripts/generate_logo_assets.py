"""
Generate the site favicon set from the brand wordmark compass mark.

Source: public/images/rocket-launch-boat-rentals-...-logo-....png
Crop:   compass rose inside the "O" of ZONE (not the full wordmark)

Run from repo root: python scripts/generate_logo_assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
LOGO = (
    ROOT
    / "public"
    / "images"
    / "rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png"
)
PUBLIC = ROOT / "public"
IMAGES = PUBLIC / "images"

# Tight crop around the compass rose in the wordmark (validated visually).
COMPASS_BOX = (920, 25, 1040, 145)
MASTER = 512


def resize_favicon(img: Image.Image, size: int) -> Image.Image:
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 32:
        resized = ImageEnhance.Contrast(resized).enhance(1.12)
        resized = ImageEnhance.Sharpness(resized).enhance(1.25)
    return resized


def build_masters(src: Image.Image) -> tuple[Image.Image, Image.Image]:
    crop = src.crop(COMPASS_BOX)
    side = max(crop.size)
    base = Image.new("RGBA", (side, side), (0, 0, 0, 255))
    base.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2), crop)
    master = base.resize((MASTER, MASTER), Image.Resampling.LANCZOS)

    mask = Image.new("L", (MASTER, MASTER), 0)
    draw = ImageDraw.Draw(mask)
    inset = 4
    draw.ellipse((inset, inset, MASTER - 1 - inset, MASTER - 1 - inset), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))

    transparent = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    transparent.paste(master, (0, 0))
    transparent.putalpha(mask)
    return transparent, master


def main() -> None:
    if not LOGO.is_file():
        raise SystemExit(f"Missing brand logo: {LOGO}")

    transparent, opaque = build_masters(Image.open(LOGO).convert("RGBA"))
    IMAGES.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    transparent.save(IMAGES / "favicon-compass.png", optimize=True)

    png_sizes = {
        "favicon-16x16.png": 16,
        "favicon-32x32.png": 32,
        "favicon-48x48.png": 48,
        "android-chrome-192x192.png": 192,
        "android-chrome-512x512.png": 512,
    }
    for name, size in png_sizes.items():
        resize_favicon(transparent, size).save(PUBLIC / name, optimize=True)
        print(f"Wrote public/{name}")

    opaque.resize((180, 180), Image.Resampling.LANCZOS).save(
        PUBLIC / "apple-touch-icon.png", optimize=True
    )
    print("Wrote public/apple-touch-icon.png")

    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    resize_favicon(transparent, 48).save(
        PUBLIC / "favicon.ico", format="ICO", sizes=ico_sizes
    )
    print("Wrote public/favicon.ico")
    print(f"Wrote {IMAGES.relative_to(ROOT)}/favicon-compass.png")


if __name__ == "__main__":
    main()
