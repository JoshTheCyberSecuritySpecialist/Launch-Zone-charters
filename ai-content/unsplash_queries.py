"""
Topic-aware Unsplash search strings — scrape-first happens in scraper/images;
this module only builds queries (no HTTP), avoiding import cycles with scraper/images.
"""

from __future__ import annotations

import re
from typing import Any

# Keyword → image intent (local / specific; avoid generic "water" alone as sole signal).
_TOPIC_TIER_PAD: dict[str, str] = {
    "rocket-titusville": "Cape Canaveral Florida Space Coast rocket launch night",
    "bioluminescent-titusville": "bioluminescence Indian River Lagoon Florida night kayak",
    "boating-port-orange": "Halifax River Port Orange Florida marina boating",
    "fishing-irl": "Indian River Lagoon Florida inshore fishing angler boat",
    "things-to-do-water-local": "Daytona Beach Titusville Florida lagoon boating waterfront",
}

_CATEGORY_TIER_PAD: dict[str, str] = {
    "Launch Updates": "Kennedy Space Center Cape Canaveral rocket launch Florida night",
    "Boating Tips": "Halifax River Florida boating marina pontoon",
    "Water Adventures": "Indian River Lagoon Florida night water kayak tour",
    "Local Highlights": "Space Coast Florida Indian River Lagoon local waterfront",
}


def _launch_signals(article: dict[str, Any]) -> bool:
    blob = (
        f"{article.get('title') or ''} {article.get('keyword_topic') or ''} {(article.get('content') or '')}"
    ).lower()
    if "rocket" in blob or "spacex" in blob:
        return True
    if "launch" in blob:
        return True
    return False


def _tier1_padding(article: dict[str, Any]) -> str:
    tid = (article.get("topic_id") or "").strip()
    cat = (article.get("category") or "").strip()
    if tid in _TOPIC_TIER_PAD:
        return _TOPIC_TIER_PAD[tid]
    if cat in _CATEGORY_TIER_PAD:
        return _CATEGORY_TIER_PAD[cat]
    return "Indian River Lagoon Titusville Florida Space Coast boating waterfront"


def _tier2_tail(article: dict[str, Any]) -> str:
    """Second-tier broadening: still anchored to place + activity, not bare 'boat water'."""
    tid = (article.get("topic_id") or "").strip()
    if tid == "rocket-titusville":
        return "Cape Canaveral Kennedy Space Center Florida launch viewing night"
    if tid == "fishing-irl":
        return "Florida east coast inshore fishing lagoon angler"
    if tid == "bioluminescent-titusville":
        return "Florida bioluminescent lagoon night paddle Indian River"
    if tid == "boating-port-orange":
        return "Volusia County Florida Intracoastal boating marina"
    if tid == "things-to-do-water-local":
        return "Volusia Brevard Florida lagoon cruise wildlife waterfront"
    cat = (article.get("category") or "").strip()
    if cat == "Launch Updates":
        return "Florida Space Coast rocket launch Cape Canaveral"
    return "Florida Space Coast Indian River Lagoon boating scenic"


def _tier3_last_resort(article: dict[str, Any]) -> str:
    """Final Unsplash attempt: specific scene classes — never a lone generic 'water' query."""
    tid = (article.get("topic_id") or "").strip()
    if tid == "rocket-titusville":
        return "rocket launch night exhaust plume Florida Space Coast"
    if tid == "fishing-irl":
        return "Florida saltwater fishing boat inlet angler"
    if tid == "bioluminescent-titusville":
        return "Florida lagoon night glow paddle bioluminescence"
    if tid == "boating-port-orange":
        return "Florida marina boats dock Intracoastal afternoon"
    if tid == "things-to-do-water-local":
        return "Florida coastal lagoon tour boat wildlife sunset"
    cat = (article.get("category") or "").strip()
    if cat == "Launch Updates":
        return "NASA rocket launch Florida coast night sky"
    if cat == "Boating Tips":
        return "Florida recreational boating Intracoastal waterway"
    return "Florida Indian River Lagoon scenic boating coast"


def build_unsplash_query_tiers(keywords: list[str], article: dict[str, Any]) -> list[tuple[int, str]]:
    """
    Tier 1–3 Unsplash search strings: topic/category-local first, then broader Florida water,
    then last-resort scene class (still not random stock).
    """
    parts = [p for p in (keywords or []) if (p or "").strip()]
    q1 = " ".join(parts).strip()
    q1 = re.sub(r"\s+", " ", q1)
    if len(q1.split()) < 4:
        q1 = f"{q1} {_tier1_padding(article)}".strip()
    q1 = re.sub(r"\s+", " ", q1)
    if _launch_signals(article):
        low = q1.lower()
        if "rocket" not in low and "launch" not in low:
            q1 = f"{q1} Space Coast rocket launch viewing Florida"
    q1 = q1[:200]

    topic_line = " ".join((article.get("keyword_topic") or "").split()).strip()
    tail = _tier2_tail(article)
    if topic_line:
        q2 = f"{topic_line} {tail}".strip()
    else:
        q2 = tail
    if _launch_signals(article) and "launch" not in q2.lower():
        q2 = f"{q2} rocket launch night"
    seen2: set[str] = set()
    q2_parts: list[str] = []
    for w in q2.split():
        wl = w.lower()
        if wl in seen2:
            continue
        seen2.add(wl)
        q2_parts.append(w)
    q2 = re.sub(r"\s+", " ", " ".join(q2_parts)).strip()[:200]

    q3 = _tier3_last_resort(article)[:200]

    tiers: list[tuple[int, str]] = [(1, q1), (2, q2), (3, q3)]
    out: list[tuple[int, str]] = []
    seen_q: set[str] = set()
    for tier, q in tiers:
        qn = re.sub(r"\s+", " ", (q or "").strip())
        if not qn or qn in seen_q:
            continue
        seen_q.add(qn)
        out.append((tier, qn))
    return out


def build_scraper_rss_fallback_query(title: str, excerpt: str) -> str:
    """
    Legacy `scrape_article()` path (non-pipeline): infer intent from title + excerpt only.
    """
    blob = f"{title} {excerpt}".lower()
    if "bioluminescence" in blob or "bioluminescent" in blob or "dinoflagellate" in blob:
        return "bioluminescence Indian River Lagoon Florida night kayak water"
    if any(
        x in blob
        for x in (
            "fish",
            "angling",
            "snook",
            "redfish",
            "trout",
            "tarpon",
            "offshore",
            "inshore",
        )
    ):
        return "fishing Indian River Lagoon Florida angler boat east coast"
    if any(x in blob for x in ("spacex", "falcon", "starship", "rocket", "nasa", "launch", "kennedy", "canaveral")):
        return "rocket launch Cape Canaveral Florida Space Coast night"
    if "boat" in blob or "boating" in blob or "marina" in blob or "pontoon" in blob:
        return "Florida Intracoastal boating marina Titusville Halifax River"
    return "Indian River Lagoon Florida Titusville waterfront boating scenic"
