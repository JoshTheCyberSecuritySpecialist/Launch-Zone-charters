"""Shared AI output quality guards for Ollama responses (Captain's Log rewrite)."""

from __future__ import annotations

import re
from typing import Any

PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.I)
    for p in (
        r"key details are limited",
        r"use available source details",
        r"plan conservatively",
        r"source excerpt unavailable",
        r"as an ai language model",
        r"lorem ipsum",
        r"unable to generate ai summary",
        r"\[insert",
        r"todo:",
    )
)

GIBBERISH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(.)\1{8,}"),
    re.compile(r"[^\x00-\x7F]{12,}"),
)


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text or ""))


def normalize_for_compare(text: str) -> str:
    t = re.sub(r"[^\w\s]", " ", (text or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def longest_repeated_phrase(text: str, min_words: int = 5, min_repeats: int = 3) -> str | None:
    words = normalize_for_compare(text).split()
    if len(words) < min_words * min_repeats:
        return None
    for size in range(min(12, len(words) // min_repeats), min_words - 1, -1):
        counts: dict[str, int] = {}
        for i in range(0, len(words) - size + 1):
            phrase = " ".join(words[i : i + size])
            counts[phrase] = counts.get(phrase, 0) + 1
            if counts[phrase] >= min_repeats:
                return phrase
    return None


def title_echo_ratio(title: str, output: str) -> float:
    t = normalize_for_compare(title)
    o = normalize_for_compare(output)
    if not t or not o:
        return 0.0
    if o.startswith(t):
        return 1.0
    t_words = {w for w in t.split() if len(w) > 3}
    o_words = [w for w in o.split() if len(w) > 3]
    if not t_words or not o_words:
        return 0.0
    hits = sum(1 for w in o_words if w in t_words)
    return hits / len(o_words)


def validate_ai_output(
    output: str,
    *,
    min_words: int = 20,
    title: str = "",
    source_text: str = "",
    prompt: str = "",
    required_sections: list[str] | None = None,
    max_title_echo: float = 0.72,
) -> tuple[bool, str, dict[str, Any]]:
    text = (output or "").strip()
    meta: dict[str, Any] = {"word_count": word_count(text)}

    if not text:
        return False, "empty_output", meta
    if meta["word_count"] < min_words:
        return False, "too_short", meta

    for pattern in PLACEHOLDER_PATTERNS:
        if pattern.search(text):
            return False, "placeholder_text", {**meta, "pattern": pattern.pattern}

    for pattern in GIBBERISH_PATTERNS:
        if pattern.search(text):
            return False, "gibberish_pattern", {**meta, "pattern": pattern.pattern}

    repeated = longest_repeated_phrase(text)
    if repeated:
        return False, "repetitive_phrase", {**meta, "repeated": repeated}

    if title.strip():
        echo = title_echo_ratio(title, text)
        meta["title_echo_ratio"] = echo
        if echo >= max_title_echo and meta["word_count"] < max(min_words + 40, 80):
            return False, "mostly_title_echo", meta

    if source_text.strip() and title.strip():
        overlap = title_echo_ratio(source_text, text)
        meta["source_echo_ratio"] = overlap
        if overlap > 0.55 and meta["word_count"] < 120:
            return False, "duplicate_source_text", meta

    if required_sections:
        lower = text.lower()
        missing = [s for s in required_sections if s.lower() not in lower]
        if missing:
            return False, "missing_required_sections", {**meta, "missing": missing}

    prompt_s = (prompt or "").strip()
    if len(prompt_s) > 40:
        prompt_tokens = {
            w
            for w in normalize_for_compare(prompt_s).split()
            if len(w) > 4
        }
        out_tokens = [w for w in normalize_for_compare(text).split() if len(w) > 4]
        if len(prompt_tokens) >= 6 and len(out_tokens) >= min_words:
            hits = sum(1 for w in out_tokens if w in prompt_tokens)
            ratio = hits / max(len(out_tokens), 1)
            meta["prompt_token_overlap"] = ratio
            if ratio < 0.02 and meta["word_count"] < 50:
                return False, "does_not_address_prompt", meta

    return True, "ok", meta
