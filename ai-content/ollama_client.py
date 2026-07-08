"""Reusable Ollama adapter for Captain's Log rewrite pipeline."""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from ai_output_quality import validate_ai_output
from config import (
    OLLAMA_MAX_RETRIES,
    OLLAMA_MODEL,
    OLLAMA_NUM_PREDICT,
    OLLAMA_STREAM_TIMEOUT_SEC,
    OLLAMA_TEMPERATURE,
    OLLAMA_TOP_P,
    OLLAMA_URL,
)
from pipeline_metrics import record_if_requests_timeout


def _resolve_base_url() -> str:
    raw = (OLLAMA_URL or "http://127.0.0.1:11434/api/generate").strip()
    return raw.replace("/api/generate", "").replace("/api/chat", "").rstrip("/")


def _resolve_model(override: str | None = None) -> str:
    return (override or OLLAMA_MODEL or "llama3.1:8b").strip() or "llama3.1:8b"


def _resolve_num_predict(override: int | None = None) -> int:
    if override and override > 0:
        return int(override)
    if OLLAMA_NUM_PREDICT and OLLAMA_NUM_PREDICT > 0:
        return int(OLLAMA_NUM_PREDICT)
    return 2400


def _resolve_temperature(override: float | None = None) -> float:
    if override is not None:
        return max(0.05, min(0.95, float(override)))
    return max(0.05, min(0.95, float(OLLAMA_TEMPERATURE)))


def _stream_generate(payload: dict[str, Any], timeout_sec: int) -> str:
    url = f"{_resolve_base_url()}/api/generate"
    parts: list[str] = []
    with requests.post(
        url,
        json=payload,
        stream=True,
        timeout=timeout_sec,
        headers={"Content-Type": "application/json"},
    ) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            try:
                chunk = json.loads(line.decode("utf-8"))
            except json.JSONDecodeError:
                continue
            parts.append(chunk.get("response", "") or "")
    return "".join(parts).strip()


def generate_text(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    temperature: float | None = None,
    num_predict: int | None = None,
    timeout_sec: int | None = None,
    stream: bool = True,
    format_json: bool = False,
) -> tuple[bool, str, str | None]:
    """Return (ok, text, error)."""
    payload: dict[str, Any] = {
        "model": _resolve_model(model),
        "prompt": str(prompt or ""),
        "stream": stream,
        "options": {
            "num_predict": _resolve_num_predict(num_predict),
            "temperature": _resolve_temperature(temperature),
            "top_p": float(OLLAMA_TOP_P),
        },
    }
    if system:
        payload["system"] = system
    if format_json:
        payload["format"] = "json"

    timeout = timeout_sec if timeout_sec else OLLAMA_STREAM_TIMEOUT_SEC
    attempts = max(1, int(OLLAMA_MAX_RETRIES))
    last_err: str | None = None

    for attempt in range(1, attempts + 1):
        try:
            if stream:
                text = _stream_generate(payload, timeout)
            else:
                url = f"{_resolve_base_url()}/api/generate"
                r = requests.post(url, json={**payload, "stream": False}, timeout=timeout)
                r.raise_for_status()
                data = r.json()
                text = str(data.get("response") or "").strip()
            if text:
                return True, text, None
            last_err = "empty_response"
        except Exception as e:
            record_if_requests_timeout(e)
            last_err = str(e)
            print(f"[ollama_client] attempt {attempt}/{attempts} failed: {e}")
        if attempt < attempts:
            time.sleep(1.5 * attempt)
    return False, "", last_err or "generation_failed"


def generate_validated(
    prompt: str,
    *,
    system: str | None = None,
    model: str | None = None,
    temperature: float | None = None,
    num_predict: int | None = None,
    timeout_sec: int | None = None,
    min_words: int = 80,
    title: str = "",
    source_text: str = "",
    required_sections: list[str] | None = None,
) -> tuple[bool, str, str | None, dict[str, Any]]:
    """Generate with one stricter retry; returns (ok, text, error, meta)."""
    meta: dict[str, Any] = {}
    ok, text, err = generate_text(
        prompt,
        system=system,
        model=model,
        temperature=temperature,
        num_predict=num_predict,
        timeout_sec=timeout_sec,
    )
    if not ok or not text:
        return False, "", err or "generation_failed", meta

    qc_ok, reason, qc_meta = validate_ai_output(
        text,
        min_words=min_words,
        title=title,
        source_text=source_text,
        prompt=prompt,
        required_sections=required_sections,
    )
    meta.update(qc_meta or {})
    if qc_ok:
        return True, text, None, meta

    strict_prompt = (
        f"{prompt}\n\nSTRICT RETRY: Paraphrase SOURCE FACTS only. "
        "Do not repeat the headline. No placeholder phrases. Follow required headings exactly."
    )
    ok2, text2, err2 = generate_text(
        strict_prompt,
        system=system,
        model=model,
        temperature=max(0.05, _resolve_temperature(temperature) - 0.08),
        num_predict=num_predict,
        timeout_sec=timeout_sec,
    )
    if not ok2 or not text2:
        return False, "", err2 or reason, meta

    qc_ok2, reason2, qc_meta2 = validate_ai_output(
        text2,
        min_words=min_words,
        title=title,
        source_text=source_text,
        prompt=prompt,
        required_sections=required_sections,
    )
    meta.update(qc_meta2 or {})
    if qc_ok2:
        meta["retried"] = True
        return True, text2, None, meta
    return False, "", reason2 or "quality_rejected", meta
