"""
Generate favicons from the canonical transparent logo.
Run from repo root: python scripts/generate_logo_assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = (
    ROOT
    / "public"
    / "images"
    / "rocket-launch-boat-rentals-titusville-florida-launch-zone-charters-logo-indian-river-lagoon.png"
)


def fit_rgba_square(src: Image.Image, out_size: int, fill_ratio: float = 0.88) -> Image.Image:
    img = src.convert("RGBA")
    target = int(out_size * fill_ratio)
    ratio = min(target / img.width, target / img.height)
    nw, nh = max(1, int(img.width * ratio)), max(1, int(img.height * ratio))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    ox, oy = (out_size - nw) // 2, (out_size - nh) // 2
    canvas.paste(resized, (ox, oy), resized)
    return canvas


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source logo: {SRC}")

    base = Image.open(SRC)
    im32 = fit_rgba_square(base, 32)
    im16 = fit_rgba_square(base, 16)
    im32.save(ROOT / "public" / "favicon-32x32.png", "PNG", optimize=True)
    im16.save(ROOT / "public" / "favicon-16x16.png", "PNG", optimize=True)
    fit_rgba_square(base, 180).save(ROOT / "public" / "apple-touch-icon.png", "PNG", optimize=True)

    im32.save(
        ROOT / "public" / "favicon.ico",
        format="ICO",
        sizes=[(32, 32), (16, 16)],
        append_images=[im16],
    )

    # Legacy single PNG some hosts expect
    im32.save(ROOT / "public" / "favicon.png", "PNG", optimize=True)

    print(
        "Wrote public/favicon.ico, favicon-32x32.png, favicon-16x16.png, "
        "apple-touch-icon.png, favicon.png"
    )


if __name__ == "__main__":
    main()
