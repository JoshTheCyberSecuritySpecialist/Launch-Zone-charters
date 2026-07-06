"""
Structure auditor + gate helpers.

Legacy mode: TITLE + ## + five required ### sections (+ optional Questions).
SEO hub mode: long-form template sections (see seo_evergreen.py).
"""

from __future__ import annotations

import re
from typing import Any

from config import PIPELINE_SEO_HUB_MODE
from source_gate import validate_paraphrase_first_article
from seo_evergreen import detect_seo_template

_H2_RE = re.compile(r"(?mi)^##\s+(.+?)\s*$")
_H3_RE = re.compile(r"(?mi)^###\s+(.+?)\s*$")
_WORD_RE = re.compile(r"\b[\w'-]+\b")

_BANNED_H2 = (
    "what to know",
    "summary",
    "article",
    "abstract",
    "local boating update",
    "key takeaways",
)

_CTA_H3 = "book your experience"

# Exact normalized heading text (legacy rewrite.py STEP 6).
_REQUIRED_H3 = (
    "what this means for your trip",
    "best ways to experience the space coast safely",
    "practical checklist before you leave the dock",
    "local context: daytona beach & space coast",
    "before you go",
)

_OPTIONAL_H3 = "questions readers ask"


def _norm(s: str) -> str:
    t = re.sub(r"\s+", " ", (s or "").strip().lower())
    t = t.replace("'", "'").replace("`", "'")
    return t


def _schema_match_score(h3: list[str], required: tuple[str, ...]) -> int:
    hs = {_norm(x) for x in h3}
    return sum(1 for need in required if need in hs)


def _audit_legacy_structure(title: str, content: str) -> tuple[bool, list[str], dict[str, Any]]:
    """Strict five-section schema (pre-SEO-hub articles)."""
    t = (title or "").strip()
    c = (content or "").strip()
    issues: list[str] = []

    h2 = [m.group(1).strip() for m in _H2_RE.finditer(c)]
    h3 = [m.group(1).strip() for m in _H3_RE.finditer(c)]
    h2n = [_norm(x) for x in h2]
    h3n = [_norm(x) for x in h3]

    required = _REQUIRED_H3
    has_questions = _OPTIONAL_H3 in set(h3n)

    if not t:
        issues.append("missing_title")
    if not c:
        issues.append("missing_content")

    if not h2:
        issues.append("missing_h2_headline")

    for b in _BANNED_H2:
        if b in h2n:
            issues.append(f"banned_h2:{b}")

    missing = [sec for sec in required if sec not in set(h3n)]
    if missing:
        issues.append(f"missing_required_h3:{','.join(missing[:6])}")

    seen: dict[str, int] = {}
    for s in h3n:
        seen[s] = seen.get(s, 0) + 1
    dups = [k for k, v in seen.items() if v > 1]
    if dups:
        issues.append(f"duplicate_h3:{','.join(dups[:6])}")

    n = len(h3)
    if has_questions:
        if n != 6:
            issues.append(f"section_count_out_of_bounds:{n}")
    else:
        if n != 5:
            issues.append(f"section_count_out_of_bounds:{n}")

    if "questions readers ask" not in set(h3n):
        if re.search(r"(?mi)^\s*\*{0,2}q:\s+", c):
            issues.append("qa_present_without_questions_section")

    cta_count = sum(1 for s in h3n if s == _CTA_H3)
    if cta_count > 1:
        issues.append("duplicate_cta_block")

    long_phrase = re.findall(r"\b(?:\w+\s+){7,}\w+\b", c.lower())
    if long_phrase:
        freq: dict[str, int] = {}
        for p in long_phrase:
            pp = " ".join(p.split())
            freq[pp] = freq.get(pp, 0) + 1
        if any(v >= 3 for v in freq.values()):
            issues.append("repeated_long_phrase")

    meta: dict[str, Any] = {
        "schema_detected": "legacy_strict",
        "h2_count": len(h2),
        "h3_count": len(h3),
        "short_schema_score": _schema_match_score(h3, required),
        "hub_schema_score": _schema_match_score(h3, required),
        "cta_h3_count": cta_count,
        "optional_questions": has_questions,
        "word_count": len(_WORD_RE.findall(c)),
    }
    return len(issues) == 0, issues, meta


def _audit_seo_hub_structure(
    title: str,
    content: str,
    *,
    category: str = "",
    keyword_topic: str = "",
    min_sections: int = 6,
) -> tuple[bool, list[str], dict[str, Any]]:
    """Paraphrase-first schema — enforced after enhancer."""
    _ = min_sections
    ok, reason, meta = validate_paraphrase_first_article(
        content,
        title=title,
        min_words=0,
        min_news_words=80,
    )
    issues: list[str] = []
    if not ok:
        issues.append(reason)
    meta = {
        **meta,
        "schema_detected": "paraphrase_first",
        "template": detect_seo_template(
            category=category,
            keyword_topic=keyword_topic,
            title=title,
            body=content,
        ),
    }
    return len(issues) == 0, issues, meta


def audit_article_structure(
    title: str,
    content: str,
    *,
    seo_hub_mode: bool | None = None,
    category: str = "",
    keyword_topic: str = "",
    min_sections: int | None = None,
) -> tuple[bool, list[str], dict[str, Any]]:
    """
    Returns (ok, issues, meta). Caller decides enforcement timing.
    SEO hub articles should be audited after the final enhancer pass.
    """
    hub = PIPELINE_SEO_HUB_MODE if seo_hub_mode is None else seo_hub_mode
    if hub:
        ms = 6 if min_sections is None else min_sections
        return _audit_seo_hub_structure(
            title,
            content,
            category=category,
            keyword_topic=keyword_topic,
            min_sections=ms,
        )
    return _audit_legacy_structure(title, content)


def blocking_structure_issues(issues: list[str], *, seo_hub_mode: bool | None = None) -> list[str]:
    """
    Issues that should fail publish unless repaired.
    SEO hub: do not block on legacy missing_required_h3 / strict section counts pre-enhancer.
    """
    hub = PIPELINE_SEO_HUB_MODE if seo_hub_mode is None else seo_hub_mode
    out: list[str] = []
    for i in issues:
        if hub:
            if (
                i.startswith("missing_boating_context_section")
                or i.startswith("news_section_too_short")
                or i.startswith("placeholder:")
                or i.startswith("below_min_words:")
                or i.startswith("headline_repeated")
                or i.startswith("duplicate_h3:")
                or i.startswith("banned_h2:")
                or i == "missing_h2_headline"
            ):
                out.append(i)
            continue
        if (
            i.startswith("missing_required_h3:")
            or i.startswith("duplicate_h3:")
            or i.startswith("banned_h2:")
            or i == "duplicate_cta_block"
            or i == "missing_h2_headline"
            or i.startswith("section_count_out_of_bounds:")
            or i == "qa_present_without_questions_section"
            or i == "repeated_long_phrase"
        ):
            out.append(i)
    return out
