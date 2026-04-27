"""
Pipeline grounding + SEO QC: outputs must trace to scraped source text; local SEO signals.
"""

from __future__ import annotations

import re
from typing import Any

from config import GROUNDING_MIN_TOKEN_OVERLAP, PIPELINE_MIN_WORDS_FINAL

# Significant tokens (length) for overlap — skip stopwords and short noise
_STOP = frozenset(
    "a an the and or but in on at to for of is are was were be been being it this that these those "
    "with from as by not no yes your you we they he she his her their our its if when then than so "
    "about into out over under up down more most some any all can could should would may might will "
    "just also only very what which who how why there here".split()
)

# Vague / filler that often indicates low-value model text (not proof of hallucination alone)
_GENERIC_PHRASES = (
    "in today's world",
    "it is important to note",
    "when it comes to",
    "whether you're a seasoned",
    "game-changer",
    "at the end of the day",
    "needless to say",
    "first and foremost",
)

# Local + commercial SEO terms for Florida boat rental intent (count distinct hits)
_SEO_TERMS = (
    "titusville",
    "daytona",
    "port orange",
    "space coast",
    "indian river",
    "lagoon",
    "brevard",
    "florida",
    "boat",
    "boating",
    "rental",
    "charter",
    "marine",
    "forecast",
    "pontoon",
    "launch",
    "rocket",
    "bioluminescence",
    "inlet",
    "weather",
    "wind",
    "safety",
    "water",
    "coast",
    "canaveral",
    "kennedy",
)


def _tokens(text: str, min_len: int = 4) -> set[str]:
    out: set[str] = set()
    for m in re.finditer(r"[a-z][a-z\-']+", (text or "").lower()):
        w = m.group().strip("'")
        if len(w) >= min_len and w not in _STOP:
            out.add(w)
    return out


def token_overlap_ratio(source: str, output: str) -> float:
    """Share of significant source tokens that appear anywhere in output (lowercased)."""
    s = _tokens(source)
    if not s:
        return 1.0
    o = (output or "").lower()
    hits = sum(1 for t in s if t in o)
    return hits / max(len(s), 1)


def _suspicious_numbers(source: str, output: str) -> list[str]:
    """Digits in output that do not appear in source (hallucinated stats risk)."""
    src = source or ""
    bad: list[str] = []
    for m in re.finditer(r"\b\d+\b", output or ""):
        num = m.group()
        if len(num) < 2:
            continue
        if num not in src:
            bad.append(num)
    return bad


def generic_phrase_hits(text: str) -> int:
    low = (text or "").lower()
    return sum(1 for g in _GENERIC_PHRASES if g in low)


def seo_local_score(text: str) -> tuple[int, list[str]]:
    """Count matching local/boating SEO terms; return (score, matched terms)."""
    low = (text or "").lower()
    matched: list[str] = []
    for term in _SEO_TERMS:
        if term in low:
            matched.append(term)
    return len(set(matched)), sorted(set(matched))


def strip_known_footer_for_qc(content: str, footer_sentence: str) -> str:
    """Remove appended CTA line before grounding compare."""
    c = (content or "").strip()
    f = (footer_sentence or "").strip()
    if f and c.lower().endswith(f.lower()):
        c = c[: -len(f)].strip().rstrip()
    return c


def validate_rewritten_article(
    source_blob: str,
    output_title: str,
    output_body: str,
    *,
    min_token_overlap: float | None = None,
    max_generic_phrases: int = 5,
    max_suspicious_numbers: int = 3,
) -> tuple[bool, str, dict[str, Any]]:
    """
    Returns (ok, reason, meta). Fails on weak overlap, too many generic phrases,
    or many numbers not present in source.
    """
    if min_token_overlap is None:
        min_token_overlap = GROUNDING_MIN_TOKEN_OVERLAP

    src = (source_blob or "").strip()
    out = f"{output_title or ''}\n{output_body or ''}".strip()
    meta: dict[str, Any] = {
        "token_overlap": round(token_overlap_ratio(src, out), 4),
        "generic_phrases": generic_phrase_hits(out),
        "suspicious_numbers": _suspicious_numbers(src, out),
    }
    seo_n, seo_terms = seo_local_score(out)
    meta["seo_term_hits"] = seo_n
    meta["seo_terms_matched"] = seo_terms[:12]

    if not out:
        return False, "empty_output", meta

    # Short RSS-only sources: overlap can be artificially low; relax threshold
    eff_min = min_token_overlap
    if len(src.split()) < 35:
        eff_min = min_token_overlap * 0.6

    if meta["token_overlap"] < eff_min and len(src.split()) > 40:
        return False, "low_source_overlap", meta

    if meta["generic_phrases"] > max_generic_phrases:
        return False, "too_generic", meta

    if len(meta["suspicious_numbers"]) > max_suspicious_numbers:
        return False, "unsupported_numbers", meta

    if seo_n < 2:
        # Strong lexical overlap with source = honest excerpt; SEO terms may still be sparse
        if meta["token_overlap"] < 0.12:
            return False, "weak_local_seo", meta

    return True, "ok", meta


def validate_final_article(
    content: str,
    *,
    source_blob: str | None,
    min_words: int | None = None,
    footer_sentence: str = "",
) -> tuple[bool, str, dict[str, Any]]:
    """Upload-time check: word count + grounding when source is available."""
    mw = min_words if min_words is not None else PIPELINE_MIN_WORDS_FINAL
    body = strip_known_footer_for_qc(content, footer_sentence)
    wc = len(re.findall(r"\b[\w'-]+\b", body))
    meta: dict[str, Any] = {"word_count": wc, "grounding_checked": bool((source_blob or "").strip())}

    if wc < mw:
        return False, f"below_min_words:{wc}", meta

    if source_blob and len(source_blob.split()) > 30:
        ok, reason, gm = validate_rewritten_article(source_blob, "", body)
        meta.update(gm)
        if not ok:
            return False, f"grounding:{reason}", meta

    return True, "ok", meta
