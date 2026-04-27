"""
SEO helpers for Captain's Log hero: keywords, alt text, filename stem (hyphenated).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_ALT_STATE_PATH = Path(__file__).resolve().parent / "pipeline_recent_image_alts.json"
_MAX_ALTS = 20


def _slug_part(s: str, max_len: int = 40) -> str:
    t = re.sub(r"[^a-z0-9]+", "-", (s or "").lower().strip())
    t = re.sub(r"-{2,}", "-", t).strip("-")
    return t[:max_len] if t else "story"


def _load_recent_alts() -> list[str]:
    try:
        if _ALT_STATE_PATH.is_file():
            data = json.loads(_ALT_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
    except Exception:
        return []
    return []


def _save_recent_alts(alts: list[str]) -> None:
    try:
        _ALT_STATE_PATH.write_text(json.dumps(alts[-_MAX_ALTS:], ensure_ascii=False), encoding="utf-8")
    except Exception:
        return


def record_published_image_alt(alt: str) -> None:
    v = (alt or "").strip()
    if not v:
        return
    arr = _load_recent_alts()
    if v in arr:
        arr.remove(v)
    arr.append(v)
    _save_recent_alts(arr)


def _article_blob(article: dict[str, Any]) -> str:
    return f"{article.get('title') or ''} {article.get('category') or ''} {(article.get('content') or '')[:2000]} {article.get('keyword_topic') or ''}".lower()


def _alt_location_phrase(blob: str) -> str:
    b = blob.lower()
    if "daytona" in b:
        return "Daytona Beach, Florida"
    if "port orange" in b:
        return "Port Orange, Florida"
    if "halifax" in b:
        return "the Halifax River area, Florida"
    if "titusville" in b or "space coast" in b:
        return "Titusville and the Space Coast, Florida"
    return "Titusville Florida on the Space Coast"


def generate_real_alt_text(article: dict[str, Any], variation: int = 0) -> str:
    blob = _article_blob(article)
    location = _alt_location_phrase(blob)
    extras = (
        "with reflections over calm water",
        "seen from a boat on the lagoon",
        "near the shoreline at night",
        "with spectators viewing from the water",
    )
    extra = extras[variation % len(extras)]

    if any(x in blob for x in ("rocket", "spacex", "falcon", "launch", "nasa", "kennedy", "artemis")):
        sentence = f"SpaceX Falcon-class rocket launching at night near {location}, {extra}."
    elif any(x in blob for x in ("fish", "fishing", "angler", "snook", "trout")):
        sentence = f"Inshore fishing boat activity near {location}, {extra}, with open lagoon views."
    elif any(x in blob for x in ("bioluminescence", "bioluminescent", "glow")):
        sentence = f"Bioluminescent water glowing near {location}, {extra}, during a night boating outing."
    else:
        sentence = f"Boating and waterfront activity near {location}, {extra}, with clear coastal conditions."

    words = sentence.split()
    if len(words) > 20:
        sentence = " ".join(words[:20]).rstrip(".") + "."
    if len(sentence.split()) < 12:
        sentence = sentence.rstrip(".") + " along the Indian River Lagoon with local marine context."
        words = sentence.split()
        if len(words) > 20:
            sentence = " ".join(words[:20]).rstrip(".") + "."
    if len(sentence) > 120:
        sentence = sentence[:117] + "..."
    return sentence


def _build_image_filename(article: dict[str, Any]) -> str:
    raw = article.get("_image_keywords")
    if isinstance(raw, list) and raw:
        parts = [_slug_part(str(x), 28) for x in raw[:8] if str(x).strip()]
        parts = [p for p in parts if p and p != "story"]
        if parts:
            name = "-".join(parts) + ".jpg"
            name = re.sub(r"-{2,}", "-", name)
            return name[:96] if len(name) > 96 else name

    blob = _article_blob(article)
    loc = "florida"
    if "daytona" in blob:
        loc = "daytona-beach-florida"
    elif "port orange" in blob:
        loc = "port-orange-florida"
    elif "titusville" in blob:
        loc = "titusville-florida"

    if any(x in blob for x in ("fish", "fishing", "angler")):
        act = "fishing-boat"
    elif any(x in blob for x in ("rental", "rent", "pontoon")):
        act = "boat-rental"
    elif any(x in blob for x in ("charter", "cruise")):
        act = "charter-boating"
    else:
        act = "boating-water"

    time_ctx = ""
    if any(x in blob for x in ("sunrise", "sunset", "night", "morning")):
        for x in ("sunrise", "sunset", "night", "morning"):
            if x in blob:
                time_ctx = x
                break

    stem = "-".join(x for x in (loc, act, time_ctx) if x)
    name = _slug_part(stem, 88) + ".jpg"
    return name[:96] if len(name) > 96 else name


def build_image_seo_fields(article: dict[str, Any]) -> dict[str, Any]:
    """
    Populate seo_keywords (list[str]), image_alt (<=120), image_seo_filename (no path).
    """
    title = (article.get("title") or "").strip()
    cat = (article.get("category") or "").strip()
    content = (article.get("content") or "")[:2000]
    kw_topic = (article.get("keyword_topic") or "").strip()
    blob = f"{title} {cat} {content} {kw_topic}".lower()

    keywords: list[str] = []
    if any(
        w in blob
        for w in (
            "rocket",
            "spacex",
            "falcon",
            "launch",
            "nasa",
            "kennedy",
            "cape canaveral",
            "artemis",
            "space coast",
        )
    ):
        keywords.append("rocket launch")
    if any(w in blob for w in ("fish", "fishing", "angler", "snook", "trout")):
        keywords.append("fishing")
    if any(w in blob for w in ("boat", "boating", "charter", "pontoon", "yacht", "vessel")):
        keywords.append("boating")
    if any(w in blob for w in ("lagoon", "indian river", "halifax", "daytona")):
        keywords.append("Indian River Lagoon")
    if any(w in blob for w in ("bioluminescence", "bioluminescent", "night paddle")):
        keywords.append("bioluminescence tour")
    keywords.append("Space Coast Florida")
    keywords.append("Titusville Florida")

    seen: set[str] = set()
    uniq: list[str] = []
    for k in keywords:
        kl = k.strip()
        if kl and kl.lower() not in seen:
            seen.add(kl.lower())
            uniq.append(kl)
        if len(uniq) >= 5:
            break
    while len(uniq) < 3:
        uniq.append("Florida boating")

    recent = {x.lower() for x in _load_recent_alts()}
    alt = generate_real_alt_text(article, 0)
    if alt.lower() in recent:
        for i in range(1, 8):
            alt = generate_real_alt_text(article, i)
            if alt.lower() not in recent:
                break

    filename = _build_image_filename(article)

    return {
        "seo_keywords": uniq[:5],
        "image_alt": alt,
        "image_seo_filename": filename,
    }


__all__ = ["build_image_seo_fields", "generate_real_alt_text", "record_published_image_alt"]
