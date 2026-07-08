"""Unit tests for shared Ollama output quality guards."""

from __future__ import annotations

import unittest

from ai_output_quality import validate_ai_output


class AiOutputQualityTests(unittest.TestCase):
    def test_rejects_placeholder(self) -> None:
        ok, reason, _ = validate_ai_output(
            "Key details are limited in the current source update.",
            min_words=5,
        )
        self.assertFalse(ok)
        self.assertEqual(reason, "placeholder_text")

    def test_rejects_repetition(self) -> None:
        text = " ".join(["Rocket launch viewing from the water is useful."] * 4)
        ok, reason, _ = validate_ai_output(text, min_words=10)
        self.assertFalse(ok)
        self.assertEqual(reason, "repetitive_phrase")

    def test_accepts_paraphrase(self) -> None:
        ok, reason, meta = validate_ai_output(
            "Forecasters expect breezy conditions on the lagoon this weekend. "
            "Boaters should verify small-craft advisories and keep plans flexible.",
            min_words=12,
            title="Marine conditions update",
        )
        self.assertTrue(ok)
        self.assertEqual(reason, "ok")
        self.assertGreaterEqual(meta.get("word_count", 0), 12)


if __name__ == "__main__":
    unittest.main()
