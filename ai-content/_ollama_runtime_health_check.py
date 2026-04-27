from __future__ import annotations
import json, time
from pathlib import Path
import requests

BASE = "http://127.0.0.1:11434"
OUT = Path("_ollama_runtime_health_report.json")


def timed_get(url: str, timeout: int = 8):
    t0 = time.perf_counter()
    try:
        r = requests.get(url, timeout=timeout)
        ok = 200 <= r.status_code < 300
        return {"ok": ok, "status": r.status_code, "latency_ms": round((time.perf_counter()-t0)*1000,1), "json": r.json() if ok else None, "err": ""}
    except Exception as e:
        return {"ok": False, "status": None, "latency_ms": round((time.perf_counter()-t0)*1000,1), "json": None, "err": str(e)}


def gen(model: str, stream: bool, timeout: int, np: int):
    t0 = time.perf_counter()
    url = f"{BASE}/api/generate"
    payload = {
        "model": model,
        "prompt": "Write one short sentence about marine conditions.",
        "stream": stream,
        "options": {"num_predict": np, "temperature": 0.1, "top_p": 0.7},
    }
    try:
        if not stream:
            r = requests.post(url, json=payload, timeout=timeout)
            r.raise_for_status()
            j = r.json()
            txt = (j.get("response") or "")
            return {
                "ok": bool(txt.strip()),
                "latency_ms": round((time.perf_counter()-t0)*1000,1),
                "first_chunk_ms": None,
                "chars": len(txt),
                "err": "",
            }
        with requests.post(url, json=payload, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            first_chunk = None
            chunks = []
            for line in r.iter_lines():
                if not line:
                    continue
                if first_chunk is None:
                    first_chunk = round((time.perf_counter()-t0)*1000,1)
                try:
                    obj = json.loads(line.decode("utf-8"))
                except Exception:
                    continue
                chunks.append(obj.get("response", "") or "")
            txt = "".join(chunks)
            return {
                "ok": bool(txt.strip()),
                "latency_ms": round((time.perf_counter()-t0)*1000,1),
                "first_chunk_ms": first_chunk,
                "chars": len(txt),
                "err": "",
            }
    except Exception as e:
        return {
            "ok": False,
            "latency_ms": round((time.perf_counter()-t0)*1000,1),
            "first_chunk_ms": None,
            "chars": 0,
            "err": str(e),
        }


def pick_small(models: list[str]) -> str | None:
    if not models:
        return None
    prefs = [
        "phi3:mini",
        "qwen2.5:0.5b",
        "qwen2:0.5b",
        "gemma:2b",
        "tinyllama",
    ]
    lower = {m.lower(): m for m in models}
    for p in prefs:
        for k,v in lower.items():
            if p in k:
                return v
    # heuristic: smallest-ish by name hints
    cands = [m for m in models if any(x in m.lower() for x in ("mini","0.5b","1b","2b","tiny"))]
    return cands[0] if cands else models[0]


def main():
    tags = timed_get(f"{BASE}/api/tags", timeout=8)
    models = []
    if tags["ok"] and isinstance(tags["json"], dict):
        models = [m.get("name") for m in tags["json"].get("models", []) if m.get("name")]

    default_model = "phi3:mini"
    small_model = pick_small(models) or default_model

    tests = {
        "default_nonstream_np16_t20": gen(default_model, stream=False, timeout=20, np=16),
        "default_stream_np16_t20": gen(default_model, stream=True, timeout=20, np=16),
        "small_nonstream_np16_t20": gen(small_model, stream=False, timeout=20, np=16),
        "small_stream_np16_t20": gen(small_model, stream=True, timeout=20, np=16),
        "small_stream_np64_t45": gen(small_model, stream=True, timeout=45, np=64),
    }

    report = {
        "tags_health": {k: tags[k] for k in ("ok","status","latency_ms","err")},
        "installed_models": models,
        "selected_small_model": small_model,
        "tests": tests,
    }

    # coarse root-cause inference
    any_ok = any(v.get("ok") for v in tests.values())
    stream_ok = any(k.endswith("stream_np16_t20") and v.get("ok") for k,v in tests.items()) or tests["small_stream_np64_t45"].get("ok")
    nonstream_ok = tests["default_nonstream_np16_t20"].get("ok") or tests["small_nonstream_np16_t20"].get("ok")
    timeout_errs = [v.get("err","") for v in tests.values() if "Read timed out" in (v.get("err") or "")]

    likely = []
    if not tags["ok"]:
        likely.append("daemon instability/unavailable")
    if tags["ok"] and not any_ok:
        likely.append("model serving latency exceeds request timeout")
    if nonstream_ok and not stream_ok:
        likely.append("stream handling/first-chunk stall")
    if timeout_errs:
        likely.append("runtime/hardware constraints causing long first-token latency")

    report["likely_root_cause"] = likely or ["inconclusive"]

    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"tags_ok": tags["ok"], "models": len(models), "any_ok": any_ok, "stream_ok": stream_ok, "nonstream_ok": nonstream_ok, "likely_root_cause": report["likely_root_cause"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
