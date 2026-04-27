import json
from pathlib import Path

p = Path(
    r"C:\Users\Josh\.cursor\projects\c-Users-Josh-MyProjects-Launch-Zone-Charters-New-version-project"
    r"\agent-transcripts\ec5bacb5-17a6-43c0-8bc8-ada4782d29be\ec5bacb5-17a6-43c0-8bc8-ada4782d29be.jsonl"
)
out = Path(__file__).resolve().parent
lines = p.read_text(encoding="utf-8").splitlines()
for idx in (754, 791, 769):
    if idx >= len(lines):
        continue
    d = json.loads(lines[idx])
    for c in d["message"]["content"]:
        if c.get("type") != "tool_use":
            continue
        name = c.get("name")
        payload = c.get("input") or {}
        if name == "ApplyPatch":
            text = payload if isinstance(payload, str) else (payload.get("input") or "")
            (out / f"_patch{idx}_apply.txt").write_text(text, encoding="utf-8")
            print(idx, "ApplyPatch", len(text))
        if name == "StrReplace":
            ns = payload.get("new_string", "") if isinstance(payload, dict) else ""
            (out / f"_patch{idx}_new.txt").write_text(ns, encoding="utf-8")
            print(idx, "StrReplace new", len(ns))
