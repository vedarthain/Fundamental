#!/usr/bin/env python3
"""extract-concalls.py — Extract, quote-verify, and store concall digests in app.concall_summary.

Downloads BSE-filed earnings call transcript PDFs from `app.announcement`, filters out
short 1–4 page intimation/audio-link cover letters, extracts text via `pdftotext`,
calls Modal GPU (`Qwen2.5-32B-AWQ`), Gemini (`temp=0.0`), or local Ollama, and
PROGRAMMATICALLY VERIFIES every returned quote against the source PDF text before
saving to `app.concall_summary`. Any unverified claim is dropped automatically.

Usage:
    # Test on specific symbols (Gemini or Modal):
    etl/.venv/bin/python scripts/extract-concalls.py --symbol TCS INFY RELIANCE --engine gemini

    # Batch priority universe (Portfolio + Watchlist + Nifty 500) on Modal GPU:
    MODAL_CONCALL_URL="https://..." etl/.venv/bin/python scripts/extract-concalls.py --engine modal --limit 100 --workers 4

    # Dry-run (prints verified JSON without writing to DB):
    etl/.venv/bin/python scripts/extract-concalls.py --symbol TCS --dry-run
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from modal_concall import SYSTEM_PROMPT  # reuse single source-of-truth prompt

MIN_PAGES = 5
MIN_CHARS = 5000
MAX_TRANSCRIPT_CHARS = 95000

VALID_TONES = {"Optimistic", "Neutral", "Cautious"}
VALID_CATEGORIES = {"Guidance", "Demand", "Margins", "Capex", "Order Book", "Risk"}
FORBIDDEN_ADVICE_RE = re.compile(
    r"\b(we recommend|investors should buy|investors should sell|target price of|strong buy|accumulate on dips)\b",
    re.I,
)

_gemini_lock = threading.Lock()
_last_gemini_ts = 0.0


def load_env() -> None:
    for p in (
        ROOT / "web" / ".env.production",
        ROOT / "web" / ".env.local",
        ROOT / "web" / ".env",
        ROOT / ".env.local",
        ROOT / ".env",
    ):
        if p.exists():
            for line in p.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v


def normalize_for_match(s: str) -> str:
    """Normalize whitespace, quotes, dashes, and PDF hyphenated line-wraps for substring checks."""
    s = s.lower()
    s = re.sub(r"-\s*\n\s*", "", s)  # rejoin hyphenated line wraps
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"[^a-z0-9₹%.\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def quote_is_verified(quote: str, norm_transcript: str, transcript_words: list[str]) -> bool:
    """Return True only if `quote` genuinely appears in the source PDF text."""
    if not quote or len(quote.strip()) < 20:
        return False
    nq = normalize_for_match(quote)
    if len(nq) < 18:
        return False
    if nq in norm_transcript:
        return True

    # Fallback for minor OCR/header interruptions in multi-column PDFs:
    # require at least one contiguous 7-word span AND >= 75% of 4-word spans to match,
    # AND every numeric token in the quote must appear in the transcript.
    q_nums = re.findall(r"\d+(?:\.\d+)?", nq)
    for num in q_nums:
        if num not in norm_transcript:
            return False

    q_words = nq.split()
    if len(q_words) < 7:
        return False

    joined = " " + " ".join(transcript_words) + " "
    has_7gram = any(" " + " ".join(q_words[i : i + 7]) + " " in joined for i in range(len(q_words) - 6))
    if not has_7gram:
        return False

    grams = [" ".join(q_words[i : i + 4]) for i in range(len(q_words) - 3)]
    hits = sum(1 for g in grams if f" {g} " in joined)
    return (hits / len(grams)) >= 0.75


def sanitize_and_verify(raw: dict[str, Any], pdf_text: str, strict: bool = True) -> tuple[dict[str, Any], float]:
    """Validate schema, enforce SEBI-safe factual rules, and drop unverified quotes."""
    norm_tx = normalize_for_match(pdf_text)
    tx_words = norm_tx.split()

    tone = str(raw.get("tone", "Neutral")).strip().title()
    if tone not in VALID_TONES:
        tone = "Neutral"

    tone_rationale = str(raw.get("tone_rationale") or "").strip()[:300]
    if FORBIDDEN_ADVICE_RE.search(tone_rationale):
        tone_rationale = ""

    q_label = str(raw.get("quarter_label") or "").strip()[:24] or None

    total_claims = 0
    verified_claims = 0

    clean_numbers: list[dict[str, str]] = []
    for item in raw.get("numbers_mentioned") or []:
        if not isinstance(item, dict):
            continue
        metric = str(item.get("metric") or "").strip()[:90]
        value = str(item.get("value") or "").strip()[:60]
        quote = str(item.get("quote") or "").strip()[:360]
        if not metric or not value or FORBIDDEN_ADVICE_RE.search(metric + " " + value):
            continue
        total_claims += 1
        ok = quote_is_verified(quote, norm_tx, tx_words)
        if ok:
            verified_claims += 1
            clean_numbers.append({"metric": metric, "value": value, "quote": quote})
        elif not strict:
            clean_numbers.append({"metric": metric, "value": value, "quote": quote})

    clean_highlights: list[dict[str, str]] = []
    for item in raw.get("highlights") or []:
        if not isinstance(item, dict):
            continue
        cat = str(item.get("category") or "Demand").strip()
        if cat not in VALID_CATEGORIES:
            cat = "Demand"
        point = str(item.get("point") or "").strip()[:320]
        quote = str(item.get("quote") or "").strip()[:360]
        if not point or FORBIDDEN_ADVICE_RE.search(point):
            continue
        total_claims += 1
        ok = quote_is_verified(quote, norm_tx, tx_words)
        if ok:
            verified_claims += 1
            clean_highlights.append({"category": cat, "point": point, "quote": quote})
        elif not strict:
            clean_highlights.append({"category": cat, "point": point, "quote": quote})

    clean_qa: list[dict[str, str]] = []
    for item in raw.get("qa_highlights") or []:
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic") or "").strip()[:80]
        question = str(item.get("question") or "").strip()[:260]
        answer = str(item.get("answer") or "").strip()[:360]
        quote = str(item.get("quote") or "").strip()[:360]
        if not topic or not answer or FORBIDDEN_ADVICE_RE.search(answer):
            continue
        total_claims += 1
        ok = quote_is_verified(quote, norm_tx, tx_words)
        if ok:
            verified_claims += 1
            clean_qa.append({"topic": topic, "question": question, "answer": answer, "quote": quote})
        elif not strict:
            clean_qa.append({"topic": topic, "question": question, "answer": answer, "quote": quote})

    ratio = (verified_claims / total_claims) if total_claims > 0 else 0.0
    return (
        {
            "quarter_label": q_label,
            "tone": tone,
            "tone_rationale": tone_rationale or None,
            "numbers_mentioned": clean_numbers[:8],
            "highlights": clean_highlights[:8],
            "qa_highlights": clean_qa[:5],
        },
        round(ratio, 3),
    )


def download_and_extract_pdf(pdf_url: str) -> tuple[str | None, str]:
    """Download BSE PDF to temp file, verify page floor, extract text via pdftotext, delete temp file."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="concall_"))
    pdf_path = tmp_dir / "doc.pdf"
    txt_path = tmp_dir / "doc.txt"
    try:
        subprocess.run(
            [
                "curl",
                "-sL",
                "-A",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
                "-H",
                "Referer: https://www.bseindia.com/",
                "--max-time",
                "90",
                "-o",
                str(pdf_path),
                pdf_url,
            ],
            check=True,
        )
        if not pdf_path.exists() or pdf_path.stat().st_size < 5000:
            return None, "empty_or_blocked_pdf"

        info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=20)
        if info.returncode != 0:
            return None, "unreadable_pdf"
        m = re.search(r"^Pages:\s+(\d+)", info.stdout, flags=re.M)
        pages = int(m.group(1)) if m else 0
        if pages < MIN_PAGES:
            return None, f"cover_letter_{pages}pp"

        subprocess.run(["pdftotext", "-layout", str(pdf_path), str(txt_path)], check=True, timeout=45)
        text = txt_path.read_text(encoding="utf-8", errors="replace").strip()
        if len(text) < MIN_CHARS:
            return None, f"scanned_or_short_{len(text)}ch"
        return text, f"{pages}pp"
    except Exception as e:
        return None, f"extract_err:{e}"
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def build_user_prompt(symbol: str, company_name: str, title: str, published_at: str, text: str) -> str:
    return (
        f"Company: {company_name} ({symbol})\n"
        f"Filing Title: {title}\n"
        f"Filing Date: {published_at}\n\n"
        f"--- BEGIN EARNINGS CALL TRANSCRIPT ---\n{text[:MAX_TRANSCRIPT_CHARS]}\n--- END TRANSCRIPT ---\n\n"
        "Extract the structured factual JSON with verbatim quotes (4-7 highlights, 2-5 numbers_mentioned, 2-4 qa_highlights)."
    )


def call_modal(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    url = os.environ.get("MODAL_CONCALL_URL", "").strip()
    if not url:
        raise RuntimeError("MODAL_CONCALL_URL env var is required for --engine modal")
    headers = {"Content-Type": "application/json"}
    tok = os.environ.get("CONCALL_API_TOKEN", "").strip()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=240) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if not body.get("ok"):
        raise RuntimeError(f"Modal error: {body.get('error')}")
    return body["data"], str(body.get("model", "modal-qwen2.5-32b-awq"))


def call_gemini(user_prompt: str, model_hint: str) -> tuple[dict[str, Any], str]:
    global _last_gemini_ts
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not found in environment or .env.local")

    candidates = (
        [model_hint]
        if model_hint != "auto"
        else [
            "models/gemini-2.5-flash",
            "models/gemini-3-flash-preview",
            "models/gemini-flash-latest",
            "models/gemini-2.0-flash",
        ]
    )
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {"temperature": 0.0, "response_mime_type": "application/json"},
    }

    last_err: Exception | None = None
    for cand in candidates:
        m_path = cand if cand.startswith("models/") else f"models/{cand}"
        url = f"https://generativelanguage.googleapis.com/v1beta/{m_path}:generateContent?key={api_key}"
        with _gemini_lock:
            wait = 1.5 - (time.monotonic() - _last_gemini_ts)
            if wait > 0:
                time.sleep(wait)
            _last_gemini_ts = time.monotonic()
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            txt = data["candidates"][0]["content"]["parts"][0]["text"]
            txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt.strip(), flags=re.S)
            return json.loads(txt), m_path.replace("models/", "")
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"Gemini failed across models: {last_err}")


def call_ollama(user_prompt: str, model_hint: str, ollama_url: str) -> tuple[dict[str, Any], str]:
    model = "qwen2.5:14b" if model_hint == "auto" else model_hint
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.0, "num_ctx": 32768},
    }
    req = urllib.request.Request(
        f"{ollama_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return json.loads(data["message"]["content"]), f"ollama:{model}"


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser(description="Extract quote-verified concall digests into app.concall_summary")
    ap.add_argument("--symbol", nargs="*", help="Specific NSE symbol(s) to process")
    ap.add_argument("--scope", choices=["priority", "all"], default="priority", help="priority = Portfolio + Watchlist + Nifty 500")
    ap.add_argument("--engine", choices=["modal", "gemini", "ollama"], default="gemini")
    ap.add_argument("--model", default="auto")
    ap.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    ap.add_argument("--limit", type=int, default=25, help="Max symbols to summarize in this run")
    ap.add_argument("--workers", type=int, default=2, help="Parallel workers (use 4-6 for Modal)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-strict-verify", action="store_true", help="Keep unverified quotes (not recommended)")
    args = ap.parse_args()

    db_url = os.environ.get("APP_DB_URL", "postgresql:///fundamental_app")

    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        if args.symbol:
            syms = [s.upper().strip() for s in args.symbol]
            cur.execute(
                """
                SELECT u.symbol, COALESCE(u.company_name, u.symbol) AS company_name
                  FROM app.universe u
                 WHERE u.symbol = ANY(%s)
                """,
                (syms,),
            )
        elif args.scope == "priority":
            cur.execute(
                """
                WITH prio AS (
                    SELECT DISTINCT symbol FROM app.portfolio_holding WHERE symbol IS NOT NULL AND quantity > 0
                    UNION
                    SELECT DISTINCT symbol FROM app.user_watchlist
                    UNION
                    SELECT DISTINCT symbol FROM app.index_constituent WHERE index_code = 'NIFTY500'
                )
                SELECT u.symbol, COALESCE(u.company_name, u.symbol) AS company_name
                  FROM app.universe u
                  JOIN prio p ON p.symbol = u.symbol
                 WHERE u.is_active
                   AND NOT EXISTS (
                       SELECT 1 FROM app.concall_summary cs
                        WHERE cs.symbol = u.symbol
                          AND cs.published_at > now() - interval '75 days'
                   )
                   AND EXISTS (
                       SELECT 1 FROM app.announcement a
                        WHERE a.symbol = u.symbol
                          AND a.pdf_url IS NOT NULL
                          AND a.published_at > now() - interval '180 days'
                          AND (a.title ~* 'transcript|earnings call|concall|conference call'
                               OR a.headline ~* 'transcript of.*(?:call|meet)')
                   )
                 ORDER BY u.symbol
                 LIMIT %s
                """,
                (args.limit,),
            )
        else:
            cur.execute(
                """
                SELECT u.symbol, COALESCE(u.company_name, u.symbol) AS company_name
                  FROM app.universe u
                 WHERE u.is_active
                   AND NOT EXISTS (
                       SELECT 1 FROM app.concall_summary cs
                        WHERE cs.symbol = u.symbol
                          AND cs.published_at > now() - interval '75 days'
                   )
                   AND EXISTS (
                       SELECT 1 FROM app.announcement a
                        WHERE a.symbol = u.symbol
                          AND a.pdf_url IS NOT NULL
                          AND a.published_at > now() - interval '180 days'
                          AND (a.title ~* 'transcript|earnings call|concall|conference call'
                               OR a.headline ~* 'transcript of.*(?:call|meet)')
                   )
                 ORDER BY u.symbol
                 LIMIT %s
                """,
                (args.limit,),
            )
        targets = cur.fetchall()

    if not targets:
        print("✓ No pending concall transcripts found for the selected scope.")
        return 0

    print(f"🎙️ Processing {len(targets)} symbol(s) with engine={args.engine} (workers={args.workers})...")

    def process_one(sym: str, company_name: str) -> str:
        t0 = time.monotonic()
        with psycopg.connect(db_url) as c2, c2.cursor() as cur2:
            cur2.execute(
                """
                SELECT a.id, COALESCE(a.headline, a.title) AS title, a.published_at, a.pdf_url
                  FROM app.announcement a
                 WHERE a.symbol = %s
                   AND a.pdf_url IS NOT NULL
                   AND a.published_at > now() - interval '365 days'
                   AND (a.title ~* 'transcript|earnings call|concall|conference call'
                        OR a.headline ~* 'transcript|earnings call|concall|conference call')
                   AND a.title !~* '^audio recording|intimation of schedule'
                   AND NOT EXISTS (
                       SELECT 1 FROM app.concall_summary cs WHERE cs.announcement_id = a.id
                   )
                 ORDER BY
                   CASE WHEN COALESCE(a.title, '') || ' ' || COALESCE(a.headline, '') ~* 'transcript' THEN 0 ELSE 1 END,
                   a.published_at DESC
                 LIMIT 4
                """,
                (sym,),
            )
            cands = cur2.fetchall()

        if not cands:
            return f"⏭️  {sym:12s} | no new candidate filings"

        chosen = None
        pdf_text = None
        note = ""
        for cid, title, pub_at, pdf_url in cands:
            txt, why = download_and_extract_pdf(pdf_url)
            if txt is not None:
                chosen = (cid, title, pub_at, pdf_url)
                pdf_text = txt
                note = why
                break
            note = why

        if not chosen or not pdf_text:
            return f"⏭️  {sym:12s} | skipped ({note})"

        cid, title, pub_at, pdf_url = chosen
        pub_iso = pub_at.isoformat() if hasattr(pub_at, "isoformat") else str(pub_at)
        sha = hashlib.sha256(pdf_text.encode("utf-8")).hexdigest()

        if args.engine == "modal":
            raw_json, used_model = call_modal(
                {
                    "symbol": sym,
                    "company_name": company_name,
                    "title": title,
                    "published_at": pub_iso[:10],
                    "transcript_text": pdf_text[:MAX_TRANSCRIPT_CHARS],
                }
            )
        elif args.engine == "gemini":
            raw_json, used_model = call_gemini(
                build_user_prompt(sym, company_name, title, pub_iso[:10], pdf_text),
                args.model,
            )
        else:
            raw_json, used_model = call_ollama(
                build_user_prompt(sym, company_name, title, pub_iso[:10], pdf_text),
                args.model,
                args.ollama_url,
            )

        cleaned, v_ratio = sanitize_and_verify(raw_json, pdf_text, strict=not args.no_strict_verify)
        if not cleaned["highlights"] and not cleaned["numbers_mentioned"]:
            return f"⚠️  {sym:12s} | 0 quotes verified ({v_ratio:.0%}) — rejected to prevent hallucination"

        if args.dry_run:
            print(json.dumps({"symbol": sym, "verified_ratio": v_ratio, **cleaned}, indent=2, ensure_ascii=False))
            return f"✓  {sym:12s} | DRY-RUN {cleaned['quarter_label']} | {cleaned['tone']} | verified={v_ratio:.0%}"

        with psycopg.connect(db_url) as c3, c3.cursor() as cur3:
            cur3.execute(
                """
                INSERT INTO app.concall_summary (
                    symbol, announcement_id, quarter_label, published_at, pdf_url,
                    tone, tone_rationale, highlights, qa_highlights, numbers_mentioned,
                    model, source_sha256, verified_ratio
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s)
                ON CONFLICT (announcement_id) DO UPDATE SET
                    quarter_label = EXCLUDED.quarter_label,
                    tone = EXCLUDED.tone,
                    tone_rationale = EXCLUDED.tone_rationale,
                    highlights = EXCLUDED.highlights,
                    qa_highlights = EXCLUDED.qa_highlights,
                    numbers_mentioned = EXCLUDED.numbers_mentioned,
                    model = EXCLUDED.model,
                    source_sha256 = EXCLUDED.source_sha256,
                    verified_ratio = EXCLUDED.verified_ratio,
                    created_at = now()
                """,
                (
                    sym,
                    cid,
                    cleaned["quarter_label"],
                    pub_at,
                    pdf_url,
                    cleaned["tone"],
                    cleaned["tone_rationale"],
                    json.dumps(cleaned["highlights"]),
                    json.dumps(cleaned["qa_highlights"]),
                    json.dumps(cleaned["numbers_mentioned"]),
                    used_model,
                    sha,
                    v_ratio,
                ),
            )
            c3.commit()

        dt = time.monotonic() - t0
        return (
            f"✅ {sym:12s} | {str(cleaned['quarter_label'] or '—'):8s} | {cleaned['tone']:10s} | "
            f"{len(cleaned['highlights'])} pts, {len(cleaned['numbers_mentioned'])} nums, {len(cleaned['qa_highlights'])} Q&A | "
            f"verified={v_ratio:.0%} ({note}, {dt:.1f}s)"
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futs = {pool.submit(process_one, s, n): s for s, n in targets}
        for fut in concurrent.futures.as_completed(futs):
            sym = futs[fut]
            try:
                print(fut.result(), flush=True)
            except Exception as e:
                print(f"❌ {sym:12s} | error: {e}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
