"""
Normalize the canonical site favicon.
Run from repo root: python scripts/generate_logo_assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FAVICON = ROOT / "public" / "images" / "favicon_launch_Zone_Charters.png"


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
    if not FAVICON.is_file():
        raise SystemExit(f"Missing favicon: {FAVICON}")

    base = Image.open(FAVICON)
    fit_rgba_square(base, 512, fill_ratio=1).save(FAVICON, "PNG", optimize=True)
    print(f"Wrote {FAVICON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
