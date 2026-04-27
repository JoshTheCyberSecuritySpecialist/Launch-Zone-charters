"""
Structured logging for image candidate evaluation — metrics only; does not change selection.

Enable with PIPELINE_IMAGE_INSTRUMENTATION=1 (see config.py).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any
from urllib.parse import urlparse

from config import PIPELINE_IMAGE_INSTRUMENTATION

# Align with scraper.IMG_RELEVANCE_RE (keyword hits in alt/url/title)
_IMG_RELEVANCE_RE = re.compile(
    r"boat|boating|water|fishing|florida|ocean|bay|lagoon|intracoastal|marine|dock|yacht|pontoon|"
    r"launch|rocket|space|saltwater|charter|harbor|vessel|coast",
    re.I,
)

_BAD_IMAGE_FILENAME_RE = re.compile(
    r"(^|[-_/])(logo|icon|avatar|favicon|sprite)([-_.]|$)|(^|[-_])(logo|icon)\.(png|jpg|jpeg|webp)|[-_]icon\d*\.(png|jpg)",
    re.I,
)

# Bonus logged only — not used by current selector
_TRUSTED_IMAGE_HOST_SUFFIXES: frozenset[str] = frozenset(
    (
        "nasa.gov",
        "spacex.com",
        "floridatoday.com",
        "spacecoastdaily.com",
        "news-journalonline.com",
        "clickorlando.com",
        "mynews13.com",
        "weather.gov",
        "noaa.gov",
    )
)

MAX_SCRAPER_CANDIDATES_LOGGED = 48
MAX_UNSPLASH_CANDIDATES_LOGGED_PER_TIER = 15


def enabled() -> bool:
    return bool(PIPELINE_IMAGE_INSTRUMENTATION)


def article_id_hash(page_url: str, title: str) -> str:
    raw = f"{(page_url or '').strip()}|{(title or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def domain_and_filename(url: str) -> tuple[str, str]:
    try:
        p = urlparse(url or "")
        host = (p.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = p.path or ""
        base = path.rsplit("/", 1)[-1] if path else ""
        return host, base
    except Exception:
        return "", ""


def keywords_hit_list(blob: str) -> list[str]:
    return sorted(set(_IMG_RELEVANCE_RE.findall(blob or "")))


def is_logo_like_filename(url: str, alt: str) -> bool:
    try:
        _, fn = domain_and_filename(url)
        if fn and _BAD_IMAGE_FILENAME_RE.search(fn):
            return True
    except Exception:
        pass
    a = (alt or "").lower()
    if re.search(r"\b(logo|wordmark|lockup|avatar)\b", a):
        return True
    return False


def is_small_dimensions(width: int | None, height: int | None, *, small_px: int = 400) -> bool:
    if width is not None and width > 0 and width < small_px:
        return True
    if height is not None and height > 0 and height < small_px:
        return True
    return False


def trusted_domain_score(host: str) -> int:
    h = (host or "").lower()
    return 15 if any(h.endswith(s) for s in _TRUSTED_IMAGE_HOST_SUFFIXES) else 0


def log_image_candidate(
    *,
    article_id: str,
    title: str,
    source: str,
    url: str,
    width: int,
    height: int,
    keywords_hit: list[str],
    is_logo_like: bool,
    is_small: bool,
    score_components: dict[str, float | int],
    final_score: float | int,
    selected: bool,
    reason_selected: str,
    extra: dict[str, Any] | None = None,
) -> None:
    if not enabled():
        return
    row: dict[str, Any] = {
        "event": "image_candidate",
        "article_id": article_id,
        "title": (title or "")[:300],
        "source": source,
        "url": (url or "")[:2000],
        "width": int(width),
        "height": int(height),
        "domain": domain_and_filename(url)[0],
        "filename": domain_and_filename(url)[1][:240],
        "keywords_hit": keywords_hit[:40],
        "is_logo_like": bool(is_logo_like),
        "is_small": bool(is_small),
        "score_components": score_components,
        "final_score": final_score,
        "selected": bool(selected),
        "reason_selected": reason_selected,
    }
    if extra:
        row["extra"] = extra
    print(json.dumps(row, ensure_ascii=False))


def log_image_article_summary(
    *,
    article_id: str,
    title: str,
    selected_source: str,
    selected_url: str,
    selected_score: float | int | None,
    tier: int | None,
    candidates_evaluated: int,
    extra: dict[str, Any] | None = None,
) -> None:
    if not enabled():
        return
    row: dict[str, Any] = {
        "event": "image_article_summary",
        "article_id": article_id,
        "title": (title or "")[:300],
        "selected_source": selected_source,
        "selected_url": (selected_url or "")[:2000],
        "selected_score": selected_score,
        "tier": tier,
        "candidates_evaluated": int(candidates_evaluated),
    }
    if extra:
        row["extra"] = extra
    print(json.dumps(row, ensure_ascii=False))


def suggested_penalties(url: str, alt: str, width: int | None, height: int | None) -> tuple[int, int, int]:
    """Returns (trusted_domain_bonus, logo_penalty, size_penalty) for logging only."""
    host, _ = domain_and_filename(url)
    td = trusted_domain_score(host)
    lp = -50 if is_logo_like_filename(url, alt) else 0
    sp = -30 if is_small_dimensions(width, height) else 0
    return td, lp, sp
