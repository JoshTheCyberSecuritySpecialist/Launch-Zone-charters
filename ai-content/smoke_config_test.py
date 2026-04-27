"""Smoke test: PIPELINE_FAST toggles SEO hub + fetch. Run: cd ai-content && python smoke_config_test.py

Sets env before each reload so local .env cannot flip expected hub mode (dotenv does not override existing keys).
"""
from __future__ import annotations

import os
import sys


def load_config() -> object:
    sys.modules.pop("config", None)
    import importlib

    return importlib.import_module("config")


def main() -> None:
    # Full SEO path: fast off, hub on (explicit — not dependent on .env)
    os.environ["PIPELINE_FAST"] = "0"
    os.environ["PIPELINE_SEO_HUB_MODE"] = "1"
    os.environ["PIPELINE_FETCH_FULL_ARTICLE"] = "1"
    c = load_config()
    assert c.PIPELINE_FAST is False
    assert c.PIPELINE_SEO_HUB_MODE is True
    assert c.PIPELINE_FETCH_FULL_ARTICLE is True
    print(
        "OK full SEO: fast=False seo_hub=True fetch_full=True "
        f"(ollama_timeout={c.OLLAMA_TIMEOUT_SEC}, stream_attempts={c.OLLAMA_STREAM_ATTEMPTS})"
    )

    # Fast path: must force hub + fetch off regardless of prior SEO env
    os.environ["PIPELINE_FAST"] = "1"
    os.environ["PIPELINE_SEO_HUB_MODE"] = "1"
    os.environ["PIPELINE_FETCH_FULL_ARTICLE"] = "1"
    c = load_config()
    assert c.PIPELINE_FAST is True
    assert c.PIPELINE_SEO_HUB_MODE is False
    assert c.PIPELINE_FETCH_FULL_ARTICLE is False
    print(
        "OK fast mode: fast=True seo_hub=False fetch_full=False "
        f"(ollama_timeout={c.OLLAMA_TIMEOUT_SEC}, stream_attempts={c.OLLAMA_STREAM_ATTEMPTS})"
    )

    # Server-style default: unset PIPELINE_FAST → not truthy → full hub if SEO_HUB_MODE stays 1
    os.environ.pop("PIPELINE_FAST", None)
    os.environ["PIPELINE_SEO_HUB_MODE"] = "1"
    os.environ["PIPELINE_FETCH_FULL_ARTICLE"] = "1"
    c = load_config()
    assert c.PIPELINE_FAST is False
    assert c.PIPELINE_SEO_HUB_MODE is True
    print("OK PIPELINE_FAST unset: fast=False (matches server default PIPELINE_FAST=0)")
    print("smoke: all assertions passed")


if __name__ == "__main__":
    main()
