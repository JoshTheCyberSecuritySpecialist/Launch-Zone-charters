"""
Source extraction gate and publish-quality checks for Captain's Log pipeline.

Articles must be built from a full publisher fetch — not RSS stubs or placeholder fallbacks.
"""

from __future__ import annotations

import re
from typing import Any

from config import PIPELINE_MIN_SOURCE_WORDS
from rewrite import fetch_source_text
from seo_evergreen import BANNED_FILLER_PHRASES, contains_banned_filler, count_title_repetitions

_WORD_RE = re.compile(r"\b[\w'-]+\b")
_H2_RE = re.compile(r"(?mi)^##\s+(.+?)\s*$")
_H3_RE = re.compile(r"(?mi)^#{2,3}\s+(.+?)\s*$")

BOATING_CONTEXT_HEADINGS: tuple[str, ...] = (
    "what this means for your space coast boat trip",
    "what this means for your trip",
    "what this means for boaters on the space coast",
)

BEFORE_YOU_GO_HEADING = "before you go"


def word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


def resolve_publishable_source(
    article: dict[str, Any],
    source_url: str = "",
) -> tuple[bool, str, dict[str, Any]]:
    """
    Fetch full article text from the publisher URL.
    Returns (ok, body_text, meta). Does not publish when fetch fails or body is too short.
    """
    url = (source_url or article.get("source_url") or article.get("url") or "").strip()
    preloaded = (article.get("content") or "").strip()
    meta: dict[str, Any] = {
        "source_url": url,
        "preloaded_word_count": word_count(preloaded),
        "extracted_word_count": 0,
        "full_text_extraction_ok": False,
        "extraction_method": "none",
        "reason": "no_source_url",
    }

    if not url.startswith("http"):
        meta["reason"] = "missing_source_url"
        return False, "", meta

    fetched = fetch_source_text(url, max_chars=20000, max_retries=2)
    wc = word_count(fetched)
    meta["extracted_word_count"] = wc
    meta["extraction_method"] = "publisher_html"

    if not fetched.strip():
        meta["reason"] = "source_fetch_failed"
        return False, "", meta

    if wc < PIPELINE_MIN_SOURCE_WORDS:
        meta["reason"] = f"source_too_short:{wc}"
        return False, "", meta

    meta["full_text_extraction_ok"] = True
    meta["reason"] = "ok"
    return True, fetched.strip(), meta


def contains_placeholder_content(text: str) -> str | None:
    """Return matched banned phrase or None."""
    hit = contains_banned_filler(text)
    if hit:
        return hit
    low = (text or "").lower()
    extra = (
        "source excerpt unavailable",
        "review the latest source update before departure",
        "treat this as a headline-only signal",
        "no article text was available from the source",
    )
    for phrase in extra:
        if phrase in low:
            return phrase
    return None


def _norm_heading(h: str) -> str:
    return re.sub(r"\s+", " ", (h or "").strip().lower())


def _boating_section_index(content: str) -> int | None:
    """Character index where the boating-context appendix begins, or None."""
    for m in _H3_RE.finditer(content or ""):
        h = _norm_heading(m.group(1))
        if h in BOATING_CONTEXT_HEADINGS or h == BEFORE_YOU_GO_HEADING:
            return m.start()
    return None


def validate_paraphrase_first_article(
    content: str,
    *,
    title: str = "",
    min_words: int = 350,
    min_news_words: int = 120,
) -> tuple[bool, str, dict[str, Any]]:
    """
    Quality gate for publish: real paraphrase body + boating appendix, no placeholders.
    """
    body = (content or "").strip()
    meta: dict[str, Any] = {
        "word_count": word_count(body),
        "title_repetitions": count_title_repetitions(body, title),
    }

    if not body:
        return False, "empty_content", meta

    wc = meta["word_count"]
    if wc < min_words:
        return False, f"below_min_words:{wc}", meta

    placeholder = contains_placeholder_content(body)
    if placeholder:
        return False, f"placeholder:{placeholder}", meta

    if meta["title_repetitions"] > 1:
        return False, "headline_repeated", meta

    if not _H2_RE.search(body):
        return False, "missing_h2_headline", meta

    boating_idx = _boating_section_index(body)
    if boating_idx is None:
        return False, "missing_boating_context_section", meta

    news_part = body[:boating_idx].strip()
    news_wc = word_count(news_part)
    meta["news_word_count"] = news_wc
    if news_wc < min_news_words:
        return False, f"news_section_too_short:{news_wc}", meta

    h3_titles = [_norm_heading(m.group(1)) for m in _H3_RE.finditer(body)]
    meta["h3_count"] = len(h3_titles)
    meta["has_before_you_go"] = BEFORE_YOU_GO_HEADING in h3_titles

    return True, "ok", meta
