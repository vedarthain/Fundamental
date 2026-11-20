#!/usr/bin/env python3
"""Generate structured EquityRoots verdicts using local Ollama.

Usage:
    # Test on a single symbol (dry-run, prints to console):
    etl/.venv/bin/python scripts/ollama-verdict.py --symbol MCX --dry-run

    # Generate and save to JSON:
    etl/.venv/bin/python scripts/ollama-verdict.py --symbol MCX --out /tmp/verdict_mcx.json

    # Generate for first 5 un-verdicted portfolio stocks:
    etl/.venv/bin/python scripts/ollama-verdict.py --portfolio --limit 5 --out /tmp/portfolio_5.json

    # Generate and directly load into app.stock_verdict:
    etl/.venv/bin/python scripts/ollama-verdict.py --symbol MCX --load
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from financial_models import evaluate_institutional_models  # noqa: E402
from valuation_engine import calculate_stock_valuation  # noqa: E402

OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434") + "/api/generate"
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")

SYSTEM_PROMPT = """You are the Senior Research Analyst at EquityRoots, an institutional equity research platform for Indian markets (NSE).
Your task is to write a comprehensive, evidence-packed fundamental investment verdict for a given stock, utilizing all provided quantitative models, peer cohort rankings, and 10-year longitudinal statements.

You must follow these strict analytical rules:
1. STRICT STRUCTURED POINTER FORMAT (CRITICAL):
   Do NOT write continuous prose sentences or narrative essays. Present every single point under "The Good" and "The Bad" as a structured, delimiter-separated pointer using this EXACT template:
   - For "The Good" (when metric is high, leading, or strong):
     * <Parameter/Metric> > <Value> - <Peer comparison / Rank / Historical Band>, - <Business reason / driver / capital impact>
   - For "The Bad" (CRITICAL: use '<' when the metric is low, lagging, depressed, or bottom-ranking; use '>' only when an adverse metric like debt or valuation ratio exceeds an acceptable threshold):
     * <Weak Metric> < <Value> - <Lowest in cluster / lags peers / ranks #5>, - <Business reason / margin impact>
     * <Adverse Metric> > <Value> - <Exceeds ceiling / high multiple>, - <Valuation / solvency risk>

   Examples of the required format:
   * Operating profit margin < 29.8% - ranks #5 of 5 (lowest in peer cohort), - depressed by analytical payroll expenses.
   * 3Y ROCE < 21.6% - dead last among capital market peers, - capital efficiency lagging peers due to idle cash.
   * CFO / PAT > 2.33x - ranks #1 among peers, - pure bank cash generation of ₹2.33 for every ₹1 of reported accounting profit.
   * Current P/E > 51.8x - 40% premium to peer median (37.0x), - sits above 10-year historical ceiling (4.8x–45.8x).
   * Net Debt / EBITDA > 2.8x - 2x higher than industry peer average, - leaves zero safety margin against commodity downcycles.

2. POPULATE AS MANY HIGH-IMPACT POINTERS AS POSSIBLE (MAXIMUM DEPTH):
   - Do NOT restrict yourself to only 4 points. Populate as many valid, high-impact points as the data supports (aim for 6 to 10+ distinct pointers under "<b>The Good:</b>" and 6 to 10+ distinct pointers under "<b>The Bad:</b>").
   - In each point, cite the EXACT numbers and compare against the industry cohort peers wherever peer rank is available.
   - Keep each pointer ultra-dense and delimiter-separated:
     * <Metric> > <Value> - <Peer comparison / Rank / Historical Band>, - <Business reason / driver / capital impact>

3. DO NOT DILUTE THE GOOD & BAD SECTIONS WITH COMPOSITE MODEL NAMES (CRITICAL):
   - Do NOT include synthetic composite model names (such as "Piotroski F-Score", "Altman Z''-Score", "Beneish M-Score", "Sloan Accrual", or "DuPont ROE") inside "<b>The Good:</b>" or "<b>The Bad:</b>".
   - The user reads those 9 quantitative models in their own dedicated visual cards below!
   - Dedicate "The Good" and "The Bad" purely to the company's ACTUAL operating metrics and business reality:
     • Core Operating Margin levels and 5-year trend slope
     • 3Y/5Y Sales CAGR and Net Profit CAGR vs peer cohort
     • 3Y/5Y ROCE and ROE (capital sweat & asset efficiency)
     • Cash flow generation: CFO / PAT, Free Cash Flow Yield, Working Capital Days
     • Solvency & Capital structure: Borrowings, Net Debt / EBITDA, Cash reserves
     • Smart Money & Ownership: DII %, FII %, Promoter holding & Pledged shares
     • Valuation cycle: Current P/E vs 10-year historical band & peer median, P/B, EV/EBITDA
     • Price action: % sessions above 200-day EMA, delivery accumulation %
     • Real-world business drivers: product pricing power, volume moats, regulatory tailwinds, customer concentration.

4. STRICT INSTITUTIONAL ACTION DECISION MATRIX (CRITICAL — DO NOT DEFAULT TO "ACCUMULATE"):
   You must choose strictly from the following 8 actions based on the company's quantitative evidence.
   DO NOT lazily default to "ACCUMULATE". Apply these rigorous decision boundaries:

   • WATCH (Mandatory for Mixed Signals, Turnarounds & Capital Efficiency Lag):
     Select WATCH whenever:
     - The company shows strong revenue growth or a compelling industry narrative, BUT 3Y/5Y ROCE is lagging (< 12%) or ranks near the bottom of its peer cohort.
     - Cash flow conversion is weak (CFO/EBIT < 0.6x or CFO/PAT < 0.7x) despite reported accounting profits.
     - Operating margins are slipping, or the company is in an early turnaround phase requiring 1–2 more quarters of proof.
     - The company has a short listing history (< 2 years) or unproven track record under varying cycles.
     RULE: If there are unanswered questions regarding cash flow, capital efficiency, or margin stability, NEVER recommend accumulating — MARK IT AS WATCH!

   • HOLD (Mandatory when Business is High Quality, but Price is Expensive):
     Select HOLD whenever:
     - The company is a high-quality franchise (Piotroski 6-9, ROCE > 15%, solid balance sheet), BUT its valuation is stretched, trading above peer medians or in the upper half of its 10-year historical P/E band.
     - RULE: If quality is sound but valuation offers no margin of safety, DO NOT advise accumulating; instruct the investor to HOLD existing positions and wait for prices/multiples to normalize.

   • ACCUMULATE (Strictly for Established Leaders at Reasonable / Consolidating Prices):
     Select ACCUMULATE ONLY when:
     - The company is an established market leader with strong ROCE (> 15%), clean books (Beneish clean, Sloan normal), and conservative leverage (Net Debt/EBITDA < 1.5x),
     - AND current valuation is trading at or below its 10-year historical median, in a healthy consolidating base where buying small amounts on market dips makes fundamental sense.
     - If valuation is stretched or cash flow is weak, DO NOT use ACCUMULATE!

   • BUY (Highest-Conviction Compounding Bargains):
     Select BUY ONLY when:
     - The company has superior capital efficiency (ROCE > 18-20%), negligible debt, excellent cash conversion (> 0.8x), clean forensic scores, and trades at an attractive discount or favorable valuation band.

   • SPECULATIVE (High Risk / High Beta / Turnaround Plays):
     Select SPECULATIVE whenever:
     - The company is an aggressive turnaround from losses, a cyclical bottom, or a deep-value asset play with heavy debt or volatile margins; upside is significant, but failure risk is elevated.

   • REDUCE (Valuation Peak / Decelerating Momentum):
     Select REDUCE whenever:
     - The stock trades near all-time peak valuation multiples (90th+ percentile of 10Y band) while profit growth is slowing or margins are under pressure; advise taking profits off the table.

   • AVOID (Structural Laggards / Poor Capital Allocators):
     Select AVOID whenever:
     - The company demonstrates chronically weak capital sweat (3Y ROCE < 8%), persistent cash burn, bottom-ranking margins in its peer cohort, and no visible operational catalyst.

   • SELL (Forensic Warnings / Severe Solvency / Broken Theses):
     Select SELL whenever:
     - High forensic manipulation risk (Beneish M-Score > -1.78), severe Sloan accruals, unsustainable debt leverage, or structural deterioration in core business operations.

5. VERDICT HEADLINE MUST BE DIRECT, ACTION-ORIENTED & IN PLAIN LAYMAN TERMINOLOGY:
   The top "verdict" field must tell the investor directly what is happening and the concrete action to take, in clear everyday layman English.
   Do NOT use passive academic or Wall Street jargon like:
   - "franchise", "oligopoly", "duopoly" -> Use "market leader", "top company", or "dominant business"
   - "trading near 10-year valuation lows" -> Use "selling at its cheapest price in a decade" or "at a 10-year bargain price"
   - "accumulate on technical pullbacks" -> Use "buy small amounts whenever the price dips"
   - "technicals base out" -> Use "wait for prices to stabilize"
   - "deteriorating operating margins" -> Use "profit margins are slipping"
   Give a direct, plain-English instruction that any non-finance person immediately understands:
   Examples:
   - "BUY — Outstanding debt-free market leader growing profits rapidly; buy confidently for long-term compounding."
   - "ACCUMULATE — Top hospital operator with steady earnings and fair valuation; buy small amounts whenever the stock price dips."
   - "HOLD — Exceptional monopoly business, but the stock price is too expensive right now; keep what you own, don't buy more yet."
   - "WATCH — Strong revenue growth but return on capital is below 8%; keep on watch and wait for profitability to improve before buying."
   - "SPECULATIVE — Turnaround automotive player with expanding sales but high debt; high risk, buy only with small risk capital."
   - "REDUCE — Stock is at an all-time peak valuation while quarterly profits are slowing down; take profits off the table."
   - "AVOID — Small player with collapsing profitability and negative free cash flow; do not buy this stock."
   - "SELL — Severe accounting red flags and soaring debt burden; exit holdings to protect capital."

OUTPUT STRUCTURE:
Your "points" array MUST contain:
- 6 to 10+ points starting with: "<b>The Good:</b> * <Metric> > <Value> - <Peer comparison>, - <Business driver>"
- 6 to 10+ points starting with: "<b>The Bad:</b> * <Risk Metric> > <Value> - <Peer comparison/band>, - <Capital/valuation risk>"
- Exactly 1 point starting with: "<i>Decision:</i> <Clear statement of action (BUY, ACCUMULATE, HOLD, WATCH, SPECULATIVE, REDUCE, AVOID, or SELL) and exact price/timing condition>"

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema:
{
  "symbol": "<SYMBOL>",
  "verdict": "<ACTION> — <One-line punchy conclusion in plain common English>",
  "confidence": "high" | "medium" | "low",
  "points": [
    "<b>The Good:</b> * ...",
    "<b>The Good:</b> * ...",
    "<b>The Good:</b> * ...",
    "<b>The Good:</b> * ...",
    "<b>The Bad:</b> * ...",
    "<b>The Bad:</b> * ...",
    "<b>The Bad:</b> * ...",
    "<b>The Bad:</b> * ...",
    "<b>Validated Parameters:</b> ...",
    "<i>Decision:</i> ..."
  ],
  "trigger_text": "<Clear condition that would cause this verdict to reverse or re-evaluate>",
  "evidence": {
    "<key1>": <exact_numeric_value_quoted>,
    "<key2>": <exact_numeric_value_quoted>
  }
}
"""


def extract_evidence_pack(symbols: list[str]) -> Path:
    """Run verdict-evidence.py to generate a temporary pack JSON."""
    out_path = Path(f"/tmp/evidence_pack_{int(datetime.now().timestamp())}.json")
    cmd = [
        str(ROOT / "etl" / ".venv" / "bin" / "python"),
        str(ROOT / "scripts" / "verdict-evidence.py"),
        "--symbols",
        ",".join(symbols),
        "--out",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("verdict-evidence stderr:\n", res.stderr)
        raise RuntimeError(f"verdict-evidence.py failed with code {res.returncode}")
    return out_path


def get_unverdicted_portfolio_symbols(limit: Optional[int] = None) -> list[str]:
    """Query DB for portfolio holdings that have no verdict yet."""
    import psycopg

    url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.symbol
                FROM app.portfolio_holding p
                LEFT JOIN (
                    SELECT DISTINCT ON (symbol) symbol, verdict
                    FROM app.stock_verdict
                    ORDER BY symbol, generated_at DESC
                ) v ON v.symbol = p.symbol
                WHERE v.verdict IS NULL AND p.symbol IS NOT NULL AND p.symbol != ''
                ORDER BY p.broker_cur_value DESC NULLS LAST;
            """)
            rows = [r[0] for r in cur.fetchall()]
            if limit:
                rows = rows[:limit]
            return rows


def call_ollama(model: str, prompt: str, system_prompt: str = SYSTEM_PROMPT) -> dict:
    """Send prompt to local Ollama instance and get parsed JSON response."""
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system_prompt,
        "format": "json",
        "stream": False,
        "keep_alive": "60m",
        "options": {
            "temperature": 0.1,
            "num_ctx": 8192,
            "num_predict": 1500,
        },
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        raw_text = res.get("response", "").strip()

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        if "```" in raw_text:
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            return json.loads(raw_text.strip())
        raise


def get_gemini_api_key() -> Optional[str]:
    """Retrieve GEMINI_API_KEY from environment or .env.local."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip().strip("\"'")
    for env_path in [ROOT / ".env.local", ROOT / "web" / ".env.local"]:
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    return None


def call_gemini(model: str, prompt: str, system_prompt: str = SYSTEM_PROMPT) -> tuple[dict, str]:
    """Send prompt to Gemini API with native JSON response formatting and fallback."""
    key = get_gemini_api_key()
    if not key:
        raise ValueError("GEMINI_API_KEY not found in environment or .env.local")

    norm_model = model.strip()
    if norm_model in ("gemini-3.1-flash-lite-latest", "gemini-3.1", "3.1"):
        norm_model = "gemini-3.1-flash-lite"

    candidates = [norm_model]
    if norm_model in ("default", "gemini", "gemini-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite"):
        candidates = [
            "models/gemini-3.5-flash-lite",
            "models/gemini-flash-lite-latest",
            "models/gemini-3.1-flash-lite",
            "models/gemini-3-flash-preview",
            "models/gemini-3.5-flash",
        ]
    elif norm_model in ("gemini-3.1-flash-lite", "models/gemini-3.1-flash-lite"):
        candidates = [
            "models/gemini-3.1-flash-lite",
            "models/gemini-3-flash-preview",
            "models/gemini-flash-lite-latest",
            "models/gemini-3.5-flash-lite",
        ]

    payload = {
        "system_instruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [
            {"parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json",
        }
    }

    text = None
    last_err = None
    used_model = model
    import time
    for attempt in range(5):
        for cand in candidates:
            model_name = cand if "/" in cand else f"models/{cand}"
            url = f"https://generativelanguage.googleapis.com/v1beta/{model_name}:generateContent?key={key}"
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    res = json.loads(resp.read().decode("utf-8"))
                    text = res["candidates"][0]["content"]["parts"][0]["text"]
                    used_model = model_name.replace("models/", "")
                    break
            except urllib.error.HTTPError as e:
                last_err = e
                if e.code == 429:
                    print(f"      [Quota 429 on {model_name}, trying next candidate...]", file=sys.stderr)
                    continue
                elif e.code in (500, 502, 503, 504):
                    time.sleep(2)
                    continue
                else:
                    continue
            except Exception as e:
                last_err = e
                continue
        if text is not None:
            break
        # If all candidates exhausted in this attempt, back off
        wait_sec = min(10 * (attempt + 1), 30)
        print(f"      [All candidates rate-limited, waiting {wait_sec}s before retry {attempt+1}/5...]", file=sys.stderr)
        time.sleep(wait_sec)

    if text is None:
        raise last_err or RuntimeError("All Gemini candidate models failed")

    parsed_data = None
    try:
        parsed_data = json.loads(text)
    except json.JSONDecodeError:
        if "```" in text:
            cleaned = text.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            parsed_data = json.loads(cleaned.strip())
        else:
            raise

    return parsed_data, used_model


def compute_forensic_and_inflection_flags(s: dict) -> dict:
    """Compute deterministic quarterly earnings inflection & forensic red flags.
    Zero LLM guesswork — derived strictly from audited quarterly, shareholding, and score tables."""
    ident = s.get("identity") or {}
    sector = str(ident.get("sector") or "").lower()
    is_financial = any(k in sector for k in ("financial", "bank", "nbfc", "insurance"))

    metrics = dict(s.get("metrics") or {})
    if isinstance(metrics.get("cluster_metrics"), dict):
        for k, v in metrics["cluster_metrics"].items():
            if metrics.get(k) is None:
                metrics[k] = v

    scores = s.get("scores") or {}
    quarterly = s.get("quarterly") or []
    sh_list = s.get("shareholding") or []

    flags: list[str] = []
    cap_reasons: list[str] = []

    # 1. Quarterly PAT & Sales YoY inflection (latest quarter vs same quarter last year)
    pat_yoy_pct = None
    sales_yoy_pct = None
    margin_compression_2q = False
    if len(quarterly) >= 5:
        q_now, q_yoy = quarterly[-1], quarterly[-5]
        p_now, p_yoy = q_now.get("net_profit"), q_yoy.get("net_profit")
        s_now, s_yoy = q_now.get("sales"), q_yoy.get("sales")
        if p_now is not None and p_yoy is not None and abs(float(p_yoy)) > 0:
            pat_yoy_pct = round(((float(p_now) - float(p_yoy)) / abs(float(p_yoy))) * 100.0, 1)
            if pat_yoy_pct <= -15.0:
                msg = f"Latest quarter PAT fell {pat_yoy_pct:+.1f}% YoY"
                flags.append(msg)
                cap_reasons.append(msg)
        if s_now is not None and s_yoy is not None and abs(float(s_yoy)) > 0:
            sales_yoy_pct = round(((float(s_now) - float(s_yoy)) / abs(float(s_yoy))) * 100.0, 1)

    # 2. Two consecutive quarters of OPM compression
    if len(quarterly) >= 3 and not is_financial:
        opms = []
        for q in quarterly[-3:]:
            sal, op = q.get("sales"), q.get("operating_profit")
            if sal and float(sal) > 0 and op is not None:
                opms.append((float(op) / float(sal)) * 100.0)
        if len(opms) == 3 and opms[2] < opms[1] < opms[0] and (opms[0] - opms[2]) >= 1.5:
            margin_compression_2q = True
            flags.append(f"OPM compressed 2 consecutive quarters ({opms[0]:.1f}% -> {opms[1]:.1f}% -> {opms[2]:.1f}%)")

    # 3. Forensic Cash-Flow conversion (non-financials)
    cfo_pat = metrics.get("cfo_pat_3y")
    if not is_financial and isinstance(cfo_pat, (int, float)) and cfo_pat < 0.7:
        msg = f"Weak 3Y cash conversion (CFO/PAT = {cfo_pat:.2f}x < 0.70x)"
        flags.append(msg)
        cap_reasons.append(msg)

    # 4. Promoter stake drop (>1% QoQ) or high/rising pledge
    if len(sh_list) >= 2:
        p0, p1 = sh_list[0].get("promoter_pct"), sh_list[1].get("promoter_pct")
        if isinstance(p0, (int, float)) and isinstance(p1, (int, float)) and (p0 - p1) <= -1.0:
            msg = f"Promoter stake dropped {p0 - p1:+.2f}% QoQ ({p1:.1f}% -> {p0:.1f}%)"
            flags.append(msg)
            cap_reasons.append(msg)
        pl0, pl1 = sh_list[0].get("pledge_pct") or 0.0, sh_list[1].get("pledge_pct") or 0.0
        if isinstance(pl0, (int, float)) and (pl0 >= 15.0 or (isinstance(pl1, (int, float)) and (pl0 - pl1) >= 5.0)):
            msg = f"Elevated/rising promoter pledge ({pl0:.1f}%)"
            flags.append(msg)
            cap_reasons.append(msg)

    # 5. Cyclical Peak Operating Margin check (OPM Now > 1.25x 3Y Avg OPM)
    #    Point-in-time backtest: OPM/3Y > 1.25x had only 53.8% win rate and -4.64% median alpha.
    def _norm_pct(val: Any) -> float | None:
        if not isinstance(val, (int, float)):
            return None
        f = float(val)
        return f * 100.0 if abs(f) <= 1.0 else f

    opm_now_pct = _norm_pct(metrics.get("opm_now"))
    opm_3y_pct = _norm_pct(metrics.get("op_margin_3y") if metrics.get("op_margin_3y") is not None else metrics.get("ebitda_margin_3y"))
    opm_ratio = None
    cyclical_peak_opm = False
    if not is_financial and opm_now_pct is not None and opm_3y_pct is not None and opm_3y_pct > 2.0:
        opm_ratio = round(opm_now_pct / opm_3y_pct, 2)
        if opm_ratio > 1.25 and (opm_now_pct - opm_3y_pct) >= 3.0:
            cyclical_peak_opm = True
            msg = f"Operating margin at potential cyclical peak ({opm_now_pct:.1f}% vs 3Y avg {opm_3y_pct:.1f}%, {opm_ratio:.2f}x)"
            flags.append(msg)
            cap_reasons.append(msg)

    # 6. Peer-relative 3M return extension & cash conversion rank
    pr = s.get("peer_ranks") or {}
    pr_metrics = pr.get("metrics") or {}
    ret_3m_rel = _norm_pct(metrics.get("ret_3m_rel"))
    ret_3m_extended = False
    if ret_3m_rel is not None and ret_3m_rel >= 18.0:
        ret_3m_extended = True
        flags.append(f"Short-term price extended (+{ret_3m_rel:.1f}% 3M relative return vs Nifty — wait for pullback)")
    else:
        r3_info = pr_metrics.get("ret_3m_rel") or {}
        rh, of = r3_info.get("rank_high"), r3_info.get("of")
        if isinstance(rh, int) and isinstance(of, int) and of >= 4 and (1.0 - (rh - 1) / of) >= 0.75 and (ret_3m_rel or 0) >= 10.0:
            ret_3m_extended = True
            flags.append(f"Short-term price extended (top-quartile 3M surge #{rh}/{of}, +{ret_3m_rel:.1f}% vs Nifty)")

    # 7. Backtest-derived score floors
    comp = scores.get("composite_pct")
    qual = scores.get("quality_pct")
    val_pct = scores.get("valuation_pct")
    mom = scores.get("momentum_pct")

    return {
        "pat_yoy_pct": pat_yoy_pct,
        "sales_yoy_pct": sales_yoy_pct,
        "margin_compression_2q": margin_compression_2q,
        "opm_ratio": opm_ratio,
        "cyclical_peak_opm": cyclical_peak_opm,
        "ret_3m_extended": ret_3m_extended,
        "composite_pct": float(comp) if isinstance(comp, (int, float)) else None,
        "quality_pct": float(qual) if isinstance(qual, (int, float)) else None,
        "valuation_pct": float(val_pct) if isinstance(val_pct, (int, float)) else None,
        "momentum_pct": float(mom) if isinstance(mom, (int, float)) else None,
        "flags": flags,
        "cap_reasons": cap_reasons,
    }


def apply_accuracy_guardrails(verdict_obj: dict, item: dict) -> list[str]:
    """Post-LLM deterministic guardrails backed by point-in-time audit-verdict-accuracy.py backtest:
      1. Quality & Composite Floor: composite < 65 or quality < 55 -> cap ACCUMULATE/BUY to WATCH (Q<55 had -3.77% median alpha)
      2. Momentum Gate: momentum_pct < 45 -> cap ACCUMULATE/BUY to WATCH
      3. Cyclical Peak & Forensic Shield: OPM > 1.25x 3Y avg (-4.64% median alpha), PAT YoY <= -15%, CFO/PAT < 0.7x, promoter dump -> cap to WATCH
      4. Valuation Stretch & 3M Spike Shield: if quality/composite are sound but valuation_pct < 35 (-0.12% alpha) or 3M surge is extended (-2.26% alpha) -> cap ACCUMULATE/BUY to HOLD (await pullback)
      5. High-Conviction Gate: confidence='high' on ACCUMULATE/BUY requires C>=75, Q>=60, V>=40, 45<=M<78
    Returns list of guardrail notes applied (empty if none fired)."""
    verdict_raw = str(verdict_obj.get("verdict") or "").strip()
    if not verdict_raw:
        return []
    first_word = verdict_raw.split()[0].upper().rstrip(",:—-")
    if first_word not in ("ACCUMULATE", "BUY"):
        return []

    diag = compute_forensic_and_inflection_flags(item)
    comp = diag["composite_pct"]
    qual = diag["quality_pct"]
    val_pct = diag["valuation_pct"]
    mom = diag["momentum_pct"]

    watch_reasons: list[str] = []
    hold_reasons: list[str] = []

    if mom is not None and mom < 45:
        watch_reasons.append(f"weak momentum ({mom:.0f}% < 45%) — await trend stabilization")
    if comp is not None and comp < 65:
        watch_reasons.append(f"composite score below floor ({comp:.0f}% < 65%)")
    if qual is not None and qual < 55:
        watch_reasons.append(f"quality score below floor ({qual:.0f}% < 55%)")
    watch_reasons.extend(diag["cap_reasons"])

    if val_pct is not None and val_pct < 35:
        hold_reasons.append(f"stretched valuation percentile ({val_pct:.0f}% < 35%) — hold and await multiple normalization")
    if diag["ret_3m_extended"]:
        hold_reasons.append("extended short-term 3M rally — hold and wait for pullback to buy-below zone")

    applied: list[str] = []
    if watch_reasons or hold_reasons:
        # If any fundamental/quality/forensic/cyclical-peak issue fired, downgrade to WATCH.
        # Otherwise (business quality is clean, only valuation is stretched or 3M price spiked), downgrade to HOLD.
        target_call = "WATCH" if watch_reasons else "HOLD"
        all_reasons = watch_reasons + hold_reasons

        if "—" in verdict_raw:
            tail = verdict_raw.split("—", 1)[1].strip()
        elif " - " in verdict_raw:
            tail = verdict_raw.split(" - ", 1)[1].strip()
        else:
            tail = verdict_raw
        verdict_obj["verdict"] = f"{target_call} — {tail}"
        if str(verdict_obj.get("confidence") or "").lower() == "high":
            verdict_obj["confidence"] = "medium"
        reason_str = "; ".join(all_reasons)
        trig = str(verdict_obj.get("trigger_text") or "").strip()
        guard_note = f"[Guardrail: Capped to {target_call} — {reason_str}]"
        verdict_obj["trigger_text"] = f"{trig} {guard_note}".strip() if trig else guard_note
        applied.append(guard_note)
    else:
        # High-Conviction Gate on surviving ACCUMULATE/BUY
        if str(verdict_obj.get("confidence") or "").lower() == "high":
            if (
                (comp is not None and comp < 75)
                or (qual is not None and qual < 60)
                or (val_pct is not None and val_pct < 40)
                or (mom is not None and (mom < 60 or mom >= 78))
            ):
                verdict_obj["confidence"] = "medium"
                applied.append(f"[Guardrail: Confidence capped to medium (C={comp}, Q={qual}, V={val_pct}, M={mom})]")

    return applied


CRITIC_SYSTEM_PROMPT = """You are a ruthless institutional short-seller and risk-committee Devil's Advocate for Indian equities.
A junior analyst just recommended ACCUMULATE / BUY on a stock. Your ONLY job is to try to BREAK the bull thesis using the audited facts provided.

Check these 5 specific kill-switches:
1. Cyclical margin peak: Is current OPM unusually elevated above 3Y average while trailing P/E looks deceptively cheap?
2. Valuation stretch: Is current P/E significantly above its 10Y historical median without matching structural growth?
3. Governance / regulatory / execution red flag: Any resignation, SEBI/USFDA/tax/ED action, pledge jump, or negative filing/news?
4. Capex / working-capital trap: Heavy capex or rising WC days likely to depress FCF / PAT over the next 2-4 quarters?
5. Weak moat / commodity exposure: Is a cyclical or commoditized business being mislabeled as a durable compounder?

Output STRICT JSON only with exactly these 3 keys:
{
  "decision": "CONFIRM" | "CAP_CONFIDENCE_MEDIUM" | "DOWNGRADE_TO_WATCH",
  "kill_risk": "One crisp sentence naming the #1 bear-case risk that could break this thesis.",
  "reason": "One concise sentence justifying your decision."
}

Be selective: only choose DOWNGRADE_TO_WATCH when there is a concrete, material red flag or clear cyclical/valuation trap. Choose CAP_CONFIDENCE_MEDIUM when the thesis is solid but carries a notable risk. Choose CONFIRM when the thesis survives scrutiny."""


def run_devils_advocate_critic(verdict_obj: dict, item: dict, engine: str, model: str) -> str | None:
    """Second-stage adversarial risk check on surviving ACCUMULATE/BUY verdicts only.
    Fail-soft: any API/JSON error leaves the primary verdict untouched."""
    verdict_raw = str(verdict_obj.get("verdict") or "").strip()
    if not verdict_raw:
        return None
    first_word = verdict_raw.split()[0].upper().rstrip(",:—-")
    if first_word not in ("ACCUMULATE", "BUY"):
        return None

    sym = item.get("symbol") or ""
    ident = item.get("identity") or {}
    scores = item.get("scores") or {}
    metrics = dict(item.get("metrics") or {})
    if isinstance(metrics.get("cluster_metrics"), dict):
        for k, v in metrics["cluster_metrics"].items():
            if metrics.get(k) is None:
                metrics[k] = v
    pe_band = item.get("pe_band") or {}
    moat = item.get("moat") or {}
    filings = (item.get("filings") or [])[:5]
    news = (item.get("news") or [])[:4]
    diag = compute_forensic_and_inflection_flags(item)

    critic_prompt = f"""AUDIT THIS ACCUMULATE/BUY CALL FOR: {sym} ({ident.get('company_name', sym)})
Sector: {ident.get('sector')} | Industry: {ident.get('industry')}
Proposed Verdict: {verdict_raw} (Confidence: {verdict_obj.get('confidence')})
Trigger: {verdict_obj.get('trigger_text')}

Key Numbers:
- Scores (C/Q/V/M): {scores.get('composite_pct')}/{scores.get('quality_pct')}/{scores.get('valuation_pct')}/{scores.get('momentum_pct')}
- P/E TTM: {metrics.get('pe_ttm')}x vs 10Y Median P/E: {pe_band.get('median')}x (Min {pe_band.get('min')}x, Max {pe_band.get('max')}x)
- OPM Now: {metrics.get('opm_now')}% vs 3Y Avg OPM: {metrics.get('op_margin_3y')}%
- 3Y ROCE: {metrics.get('roce_3y')}% | 3Y CFO/PAT: {metrics.get('cfo_pat_3y')}x | Net Debt/EBITDA: {metrics.get('net_debt_ebitda')}x
- Moat: {moat.get('moat_strength') or 'Unprofiled'} ({moat.get('moat_type') or 'N/A'})
- Forensic/Inflection Flags: {diag['flags'] or 'None'}
- Recent Filings: {[f"{f.get('date')} {f.get('category')}: {str(f.get('text',''))[:90]}" for f in filings]}
- Recent News: {[f"{n.get('date')} ({n.get('source')}): {str(n.get('title',''))[:90]}" for n in news]}

Return strict JSON: decision, kill_risk, reason."""

    try:
        if engine == "gemini":
            res, _ = call_gemini(model, critic_prompt, system_prompt=CRITIC_SYSTEM_PROMPT)
        else:
            res = call_ollama(model, critic_prompt, system_prompt=CRITIC_SYSTEM_PROMPT)
    except Exception:
        return None

    if not isinstance(res, dict):
        return None

    decision = str(res.get("decision") or "CONFIRM").strip().upper()
    kill_risk = str(res.get("kill_risk") or "").strip()
    reason = str(res.get("reason") or "").strip()

    if kill_risk:
        pts = verdict_obj.get("points") or []
        pts.append(f"<b>Bear-Case Risk (Critic):</b> {kill_risk}")
        verdict_obj["points"] = pts

    if decision == "DOWNGRADE_TO_WATCH":
        if "—" in verdict_raw:
            tail = verdict_raw.split("—", 1)[1].strip()
        elif " - " in verdict_raw:
            tail = verdict_raw.split(" - ", 1)[1].strip()
        else:
            tail = verdict_raw
        verdict_obj["verdict"] = f"WATCH — {tail}"
        if str(verdict_obj.get("confidence") or "").lower() == "high":
            verdict_obj["confidence"] = "medium"
        note = f"[Critic: Downgraded to WATCH — {reason or kill_risk}]"
        trig = str(verdict_obj.get("trigger_text") or "").strip()
        verdict_obj["trigger_text"] = f"{trig} {note}".strip() if trig else note
        return note
    elif decision == "CAP_CONFIDENCE_MEDIUM":
        if str(verdict_obj.get("confidence") or "").lower() == "high":
            verdict_obj["confidence"] = "medium"
        return f"[Critic: Confidence capped to medium — {reason or kill_risk}]"
    else:
        return f"[Critic: CONFIRMED — risk noted: {kill_risk[:80]}]" if kill_risk else "[Critic: CONFIRMED]"


def format_symbol_evidence_prompt(s: dict) -> str:
    """Format the raw symbol data into a comprehensive prompt utilizing all fundamental parameters."""
    symbol = s.get("symbol")
    ident = s.get("identity") or {}
    metrics = dict(s.get("metrics") or {})
    if "cluster_metrics" in metrics and isinstance(metrics["cluster_metrics"], dict):
        for k, v in metrics["cluster_metrics"].items():
            if metrics.get(k) is None:
                metrics[k] = v
    scores = s.get("scores") or {}
    annual = s.get("annual") or []
    quarterly = s.get("quarterly") or []
    pe_band = s.get("pe_band") or {}
    blockers = s.get("blockers") or []
    ttm = s.get("ttm_vs_prior") or {}

    pr = s.get("peer_ranks") or {}
    pr_metrics = pr.get("metrics") or {}
    pr_scores = pr.get("scores") or {}
    pr_sh = pr.get("shareholding") or {}

    def _rk(key: str, subdict: dict = pr_metrics) -> str:
        info = subdict.get(key)
        if not info or not isinstance(info, dict):
            return ""
        rh = info.get("rank_high")
        of = info.get("of")
        ahead = info.get("ahead", [])
        if rh is not None and of is not None:
            if rh == 1:
                return f" [PEER RANK: #1 of {of} — LEADS CLUSTER]"
            elif ahead:
                return f" [PEER RANK: #{rh} of {of}; behind {', '.join(ahead)}]"
            return f" [PEER RANK: #{rh} of {of}]"
        return ""

    mcap = metrics.get("market_cap") or ident.get("market_cap_cr") or "N/A"
    current_price = metrics.get("current_price") or ident.get("current_price") or "N/A"

    # Compute Layer 1 Institutional Models
    inst_models = evaluate_institutional_models(s)
    playbook = inst_models.get("sector_playbook") or {}
    piotroski = inst_models.get("piotroski") or {}
    altman = inst_models.get("altman_z") or {}
    sloan = inst_models.get("sloan_accruals") or {}
    beneish = inst_models.get("beneish_m") or {}
    dupont = inst_models.get("dupont_5") or {}
    lynch = inst_models.get("peter_lynch") or {}
    conversion = inst_models.get("cash_conversion") or {}
    val_band = inst_models.get("valuation_band") or {}

    # Full annual history (latest 6 fiscal years)
    ann_lines = []
    for r in annual[:6]:
        p = r.get("period_end", "N/A")
        s_val = r.get("sales")
        op_val = r.get("operating_profit")
        np_val = r.get("net_profit")
        cfo_val = r.get("cash_from_operating")
        debt_val = r.get("borrowings") or 0.0
        res_val = r.get("reserves") or 0.0
        ann_lines.append(f"  - FY {p}: Sales ₹{s_val}Cr, OpProfit ₹{op_val}Cr, PAT ₹{np_val}Cr, CFO ₹{cfo_val}Cr, Borrowings ₹{debt_val}Cr, Reserves ₹{res_val}Cr")
    ann_str = "\n".join(ann_lines) if ann_lines else "No annual filings available."

    # Trailing quarters (latest 6 quarters)
    q_lines = []
    for r in quarterly[:6]:
        p = r.get("period_end", "N/A")
        s_val = r.get("sales")
        op_val = r.get("operating_profit")
        np_val = r.get("net_profit")
        q_lines.append(f"  - Qtr {p}: Sales ₹{s_val}Cr, OpProfit ₹{op_val}Cr, PAT ₹{np_val}Cr")
    q_str = "\n".join(q_lines) if q_lines else "No quarterly filings available."

    # Shareholding
    sh_list = s.get("shareholding") or []
    sh = sh_list[0] if sh_list else {}

    # Company Moat
    moat_obj = s.get("moat") or {}
    if moat_obj and moat_obj.get("moat_points"):
        pts = moat_obj.get("moat_points") or []
        moat_lines = [f"- Strength: {moat_obj.get('moat_strength') or 'N/A'} | Type: {moat_obj.get('moat_type') or 'N/A'}"]
        for pt in pts[:5]:
            moat_lines.append(f"  * {pt}")
        moat_str = "\n".join(moat_lines)
    else:
        moat_str = "Not yet profiled."

    # Material BSE/NSE Exchange Filings (90d)
    filings = s.get("filings") or []
    if filings:
        filings_str = "\n".join(
            f"- [{f.get('date', '')}] ({f.get('category', 'Filing')}) {str(f.get('text', ''))[:180]}"
            for f in filings[:10]
        )
    else:
        filings_str = "No material non-boilerplate filings in last 90 days."

    # Recent News & Catalysts / Red Flags (60d)
    news_items = s.get("news") or []
    if news_items:
        news_str = "\n".join(
            f"- [{n.get('date', '')}] ({n.get('source', 'News')}) {str(n.get('title', ''))[:180]}"
            for n in news_items[:6]
        )
    else:
        news_str = "No recent material news headlines."

    prompt = f"""EVIDENCE PACK FOR: {symbol} ({ident.get('company_name', symbol)})
Industry: {ident.get('industry', 'N/A')} | Sector: {ident.get('sector', 'N/A')} | Cluster: {ident.get('cluster_id', 'N/A')}
Sector Playbook: {playbook.get('name', 'N/A')} (Category: {playbook.get('category', 'N/A')})
Market Cap: ₹{mcap} Cr{_rk('market_cap', pr_scores)} | Current Price: ₹{current_price}

1. DETERMINISTIC INSTITUTIONAL MODELS:
- Piotroski F-Score: {piotroski.get('summary', 'N/A')}
- Altman Z''-Score (Solvency): {altman.get('summary', 'N/A')}
- Sloan Accrual Ratio (Earnings Integrity): {sloan.get('summary', 'N/A')}
- Beneish M-Score (Earnings Manipulation Shield): {beneish.get('summary', 'N/A')}
- DuPont 5-Stage ROE Drivers: {dupont.get('summary', 'N/A')}
- Peter Lynch Growth Model & PEG: {lynch.get('summary', 'N/A')}
- Buffett Cash Conversion & FCF: {conversion.get('summary', 'N/A')}
- Historical 10-Year Valuation Position: {val_band.get('summary', 'N/A')}
- Technical Trend & Timing: {inst_models.get('technicals', {}).get('summary', 'N/A')}

2. CAPITAL EFFICIENCY & RETURNS (WITH PEER RANKS):
- 3Y ROCE: {metrics.get('roce_3y')}%{_rk('roce_3y')}
- 5Y ROCE: {metrics.get('roce_5y')}%{_rk('roce_5y')}
- 3Y ROE: {metrics.get('roe_3y')}%{_rk('roe_3y')}
- System Quality Percentile: {scores.get('quality_pct')}%{_rk('quality_pct', pr_scores)}

3. OPERATING MARGINS & PRICING POWER (WITH PEER RANKS):
- Current Operating Margin (opm_now): {metrics.get('opm_now')}%{_rk('opm_now')}
- Previous Operating Margin (opm_prev): {metrics.get('opm_prev')}%
- 3Y Average Operating Margin: {metrics.get('op_margin_3y')}%{_rk('op_margin_3y')}
- 5Y Margin Trend Slope: {metrics.get('op_margin_trend')}% / year

4. CASH FLOW REALITY & WORKING CAPITAL (WITH PEER RANKS):
- 3Y Average CFO / PAT: {metrics.get('cfo_pat_3y')}x{_rk('cfo_pat_3y')}
- Latest Year Cash Conversion (CFO / EBIT): {conversion.get('conversion_latest')}x
- Free Cash Flow Yield: {metrics.get('fcf_yield')}%{_rk('fcf_yield')}
- Working Capital Days: {metrics.get('wc_days')} days
- Net Debt to EBITDA: {metrics.get('net_debt_ebitda')}x

5. LONGITUDINAL GROWTH TRAJECTORY:
- 5Y Sales CAGR: {metrics.get('rev_cagr_5y')}%
- 5Y Net Profit CAGR: {metrics.get('np_cagr_5y')}%{_rk('np_cagr_5y')}
- Trailing 12M Sales Growth vs Prior 12M: {ttm.get('ttm_sales_pct')}%{_rk('ttm_sales_pct')}
- Trailing 12M Op Profit Growth vs Prior 12M: {ttm.get('ttm_op_pct')}%{_rk('ttm_op_pct')}
- Trailing 12M Net Profit Growth vs Prior 12M: {ttm.get('ttm_np_pct')}%{_rk('ttm_np_pct')}

6. SMART MONEY & OWNERSHIP STRUCTURE (WITH PEER RANKS):
- Domestic Institutions (DII): {sh.get('dii_pct') or metrics.get('dii_pct')}%{_rk('dii_pct', pr_sh or pr_metrics)}
- Foreign Institutions (FII): {sh.get('fii_pct') or metrics.get('fii_pct')}%{_rk('fii_pct', pr_sh or pr_metrics)}
- Promoter Stake: {sh.get('promoter_pct') or metrics.get('promoter_pct')}%{_rk('promoter_pct', pr_sh or pr_metrics)}
- Promoter Pledged Shares: {sh.get('pledge_pct') or metrics.get('pledge_pct') or 0.0}%
- Retail Public Stake: {sh.get('public_pct') or metrics.get('public_pct')}%

7. VALUATION MULTIPLES & HISTORICAL 10-YEAR RANGE:
- Current P/E (TTM): {metrics.get('pe_ttm')}x{_rk('pe_ttm')}
- P/B: {metrics.get('pb')}x | EV/EBITDA: {metrics.get('ev_ebitda_ttm')}x | EV/Sales: {metrics.get('ev_sales_ttm')}x{_rk('ev_sales_ttm')}
- 10-Year Historical P/E Band: Min {pe_band.get('min')}x, Median {pe_band.get('median')}x, Max {pe_band.get('max')}x

8. TECHNICAL STRUCTURE & MOMENTUM (OHLC):
- % Trading Sessions above 200-day EMA (252d): {metrics.get('pct_above_200ema_252d')}{_rk('pct_above_200ema_252d')}
- Bullish EMA Stack (20>50>100>200): {metrics.get('ema_stack_bull')}
- 12M Relative Return vs Nifty: {metrics.get('ret_12m_rel')}%{_rk('ret_12m_rel')}
- Institutional Delivery: {inst_models.get('technicals', {}).get('avg_delivery_pct')}%

9. LONGITUDINAL ANNUAL RECORD:
{ann_str}

10. RECENT QUARTERLY RECORD:
{q_str}

11. COMPETITIVE MOAT PROFILE:
{moat_str}

12. RECENT MATERIAL BSE/NSE EXCHANGE FILINGS (LAST 90 DAYS):
{filings_str}

13. RECENT NEWS & CATALYSTS / RED FLAGS (LAST 60 DAYS):
{news_str}

14. DETERMINISTIC EARNINGS INFLECTION & FORENSIC SHIELD:
{chr(10).join('- ' + f for f in compute_forensic_and_inflection_flags(s)['flags']) if compute_forensic_and_inflection_flags(s)['flags'] else 'No deterministic earnings/cash-flow/promoter red flags triggered.'}

BLOCKERS & FLAGS:
{json.dumps(blockers, indent=2) if blockers else 'None flagged.'}

Write the comprehensive EquityRoots verdict JSON for {symbol}.
Remember:
- Populate as many valid, high-impact points as possible (aim for 6 to 10+ distinct pointers under "<b>The Good:</b>" and 6 to 10+ distinct pointers under "<b>The Bad:</b>").
- Cover all dimensions: Operating Margins, ROCE/ROE, Cash Flow/Sloan, Solvency, 5Y Growth, Smart Money, 10Y PE Band, and Technicals.
- Use Sections 11-13 (Moat, Exchange Filings, News) as catalyst & red-flag checks: explicitly flag governance/regulatory/resignation/pledge red flags or material order wins/capex catalysts, and NEVER override weak fundamentals on news hype alone.
- Keep each point strictly in the delimiter-separated format: * <Metric> > <Value> - <Peer comparison>, - <Business driver>
"""
    return prompt


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--symbol", help="Single stock symbol (e.g. MCX)")
    ap.add_argument("--symbols", help="Comma-separated stock symbols (e.g. CAMS,CRISIL,ICRA)")
    ap.add_argument("--cluster", help="Cluster ID or integer index from clusters_queue.txt (e.g. 3 or cap_goods_precision_eng)")
    ap.add_argument("--clusters", help="Multiple cluster IDs, indices, or ranges (e.g. '1,2,3', '1-5', '1-5,11,12')")
    ap.add_argument("--next-cluster", action="store_true", help="Automatically pick the next cluster that has un-refreshed stocks")
    ap.add_argument("--list-clusters", action="store_true", help="Display all clusters with queue indices and exit")
    ap.add_argument("--portfolio", action="store_true", help="Process un-verdicted portfolio stocks")
    ap.add_argument("--weekly-new-portfolio", action="store_true", help="Process latest-batch new calls and active portfolio stocks missing a verdict from the last 7 days")
    ap.add_argument("--claude-stocks", action="store_true", help="Process stocks that have Claude verdicts but lack Gemini verdicts")
    ap.add_argument("--no-critic", action="store_true", help="Skip the Devil's Advocate bear-case critic pass on ACCUMULATE/BUY verdicts")
    ap.add_argument("--since", help="Process symbols that had verdicts generated on or after this date (e.g. 2026-10-25)")
    ap.add_argument("--unverdicted", action="store_true", help="Process active universe symbols that do not yet have a verdict")
    ap.add_argument("--drift", action="store_true", help="Process stocks whose stored evidence has drifted from live cluster metrics")
    ap.add_argument("--workers", type=int, default=1, help="Concurrent workers (default: 1; use 3-5 for fast parallel Gemini generation)")
    ap.add_argument("--delay", type=float, default=3.0, help="Delay in seconds between LLM calls to go easy on Gemini (default: 3.0s)")
    ap.add_argument("--limit", type=int, default=None, help="Limit number of symbols to process")
    ap.add_argument("--engine", choices=["gemini", "ollama"], default="gemini", help="Inference engine: gemini or ollama (default: gemini)")
    ap.add_argument("--model", default=None, help="Model name (default: gemini-3.8-flash for gemini, qwen2.5:14b for ollama)")
    ap.add_argument("--out", help="Write verdicts JSON to this path")
    ap.add_argument("--load", action="store_true", help="Load generated verdicts into app.stock_verdict")
    ap.add_argument("--skip-existing", action="store_true", help="Skip symbols that already have a verdict for the chosen engine")
    ap.add_argument("--dry-run", action="store_true", help="Print verdicts to stdout without loading")
    args = ap.parse_args()

    if args.list_clusters:
        qtxt = ROOT / "clusters_queue.txt"
        if qtxt.exists():
            print(qtxt.read_text())
        else:
            print("clusters_queue.txt not found. Run: etl/.venv/bin/python scripts/build_clusters_queue.py")
        return 0

    if not args.model:
        args.model = "gemini-3.5-flash-lite" if args.engine == "gemini" else DEFAULT_MODEL

    target_clusters: list[dict] = []
    cluster_spec = (args.clusters or args.cluster or "").strip()

    if args.next_cluster:
        qpath = ROOT / "clusters_queue.json"
        if not qpath.exists():
            print("✗ clusters_queue.json not found. Run: etl/.venv/bin/python scripts/build_clusters_queue.py")
            return 1
        cq = json.loads(qpath.read_text())
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                for c in cq:
                    cid = c["cluster_id"]
                    cur.execute("""
                        SELECT 1
                        FROM app.cluster_assignment ca
                        JOIN app.stock_verdict v ON v.symbol = ca.symbol
                        WHERE ca.cluster_id = %s
                          AND v.generated_at >= '2026-10-25' AND v.generated_at < CURRENT_DATE
                          AND NOT EXISTS (
                              SELECT 1 FROM app.stock_verdict v2
                              WHERE v2.symbol = ca.symbol AND v2.generated_at >= CURRENT_DATE
                          )
                        LIMIT 1;
                    """, (cid,))
                    if cur.fetchone():
                        target_clusters = [c]
                        print(f"🎯 Auto-picked Next Cluster #{c['index']}: '{cid}' ({c['cluster_name']})\n")
                        break
        if not target_clusters:
            print("✓ All clusters from yesterday have already been refreshed today!")
            return 0
    elif cluster_spec:
        qpath = ROOT / "clusters_queue.json"
        cq = []
        if qpath.exists():
            cq = json.loads(qpath.read_text())
        idx_map = {c["index"]: c for c in cq}
        id_map = {c["cluster_id"]: c for c in cq}

        seen_cids = set()
        parts = [p.strip() for p in cluster_spec.split(",") if p.strip()]
        for p in parts:
            if "-" in p and all(sub.strip().isdigit() for sub in p.split("-", 1)):
                lo, hi = map(int, [sub.strip() for sub in p.split("-", 1)])
                for i in range(lo, hi + 1):
                    if i in idx_map and idx_map[i]["cluster_id"] not in seen_cids:
                        target_clusters.append(idx_map[i])
                        seen_cids.add(idx_map[i]["cluster_id"])
                    elif i not in idx_map:
                        print(f"Warning: Cluster index #{i} not found in queue (1..{len(cq)})", file=sys.stderr)
            elif p.isdigit():
                i = int(p)
                if i in idx_map and idx_map[i]["cluster_id"] not in seen_cids:
                    target_clusters.append(idx_map[i])
                    seen_cids.add(idx_map[i]["cluster_id"])
                elif i not in idx_map:
                    print(f"Warning: Cluster index #{i} not found in queue (1..{len(cq)})", file=sys.stderr)
            elif p in id_map:
                if p not in seen_cids:
                    target_clusters.append(id_map[p])
                    seen_cids.add(p)
            else:
                if p not in seen_cids:
                    target_clusters.append({"index": -1, "cluster_id": p, "cluster_name": p})
                    seen_cids.add(p)

        if not target_clusters:
            print(f"✗ Could not resolve any valid clusters from spec '{cluster_spec}'")
            return 1

    import time
    start_total_time = time.time()

    print("\n" + "=" * 80)
    print("🏛️  EQUITYROOTS FUNDAMENTAL VERDICT ENGINE")
    print("=" * 80)
    print(f"Engine:         {args.engine.upper()} (Model: {args.model})")
    if target_clusters:
        if len(target_clusters) == 1:
            c = target_clusters[0]
            target_desc = f"Cluster #{c['index']}: {c['cluster_id']} ({c['cluster_name']})" if c['index'] > 0 else f"Cluster: {c['cluster_id']}"
        else:
            target_desc = f"{len(target_clusters)} Clusters: " + ", ".join([f"#{c['index']}" if c['index'] > 0 else c['cluster_id'] for c in target_clusters])
    else:
        target_desc = (
            f"Symbol: {args.symbol}" if args.symbol else
            f"Symbols: {args.symbols}" if args.symbols else
            f"Verdicts generated on or after {args.since}" if args.since else
            "Active universe stocks needing verdicts" if args.unverdicted else
            "Stocks with evidence drift needing re-verdict" if args.drift else
            "Claude-verdicted stocks needing Gemini" if args.claude_stocks else
            "Weekly new calls + portfolio holdings needing refresh" if args.weekly_new_portfolio else
            "Un-verdicted portfolio holdings"
        )
    print(f"Target Mode:    {target_desc}")
    print(f"Auto-Load DB:   {'ENABLED (direct upsert to app.stock_verdict)' if args.load else 'DISABLED'}")
    print(f"Skip Existing:  {'ENABLED' if args.skip_existing else 'DISABLED'}")
    print(f"Request Delay:  {args.delay:.1f}s per stock")
    print("=" * 80 + "\n")

    symbols = []
    if args.symbol:
        symbols = [args.symbol.strip().upper()]
    elif args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    elif target_clusters:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        print("🎯 Selected Clusters & Stock Breakdown:")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                for c in target_clusters:
                    cid = c["cluster_id"]
                    cname = c.get("cluster_name", cid)
                    cidx = c.get("index", -1)
                    if args.since:
                        cur.execute("""
                            SELECT DISTINCT ca.symbol 
                            FROM app.cluster_assignment ca
                            JOIN app.stock_verdict v ON v.symbol = ca.symbol
                            WHERE ca.cluster_id = %s
                              AND v.generated_at >= %s::timestamptz AND v.generated_at < CURRENT_DATE
                              AND NOT EXISTS (
                                  SELECT 1 FROM app.stock_verdict v2
                                  WHERE v2.symbol = ca.symbol AND v2.generated_at >= CURRENT_DATE
                              )
                            ORDER BY ca.symbol;
                        """, (cid, args.since))
                    else:
                        cur.execute("SELECT symbol FROM app.cluster_assignment WHERE cluster_id = %s ORDER BY symbol;", (cid,))
                    c_syms = [r[0] for r in cur.fetchall()]
                    tag = f"[#{cidx:>2}]" if cidx != -1 else "[-]"
                    status_text = f"{len(c_syms)} stock(s) to process" if c_syms else "already up to date ✓"
                    print(f"  • {tag} {cid:<32} ({cname}): {status_text}")
                    symbols.extend(c_syms)
        if not symbols:
            print(f"\n✓ All requested symbols across selected cluster(s) are already up to date.")
            return 0
    elif args.since:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                since_str = str(args.since).strip().split()[0]
                today_str = str(date.today())
                if since_str < today_str:
                    cur.execute("""
                        SELECT DISTINCT v.symbol
                        FROM app.stock_verdict v
                        WHERE v.generated_at >= %s::timestamptz AND v.generated_at < CURRENT_DATE
                          AND NOT EXISTS (
                              SELECT 1 FROM app.stock_verdict v2 
                              WHERE v2.symbol = v.symbol AND v2.generated_at >= CURRENT_DATE
                          )
                        ORDER BY v.symbol;
                    """, (args.since,))
                else:
                    cur.execute("""
                        SELECT DISTINCT symbol
                        FROM app.stock_verdict
                        WHERE generated_at >= %s::timestamptz
                        ORDER BY symbol;
                    """, (args.since,))
                symbols = [r[0] for r in cur.fetchall()]
        if not symbols:
            print(f"✓ All stocks generated on or after {args.since} have already been refreshed today.")
            return 0
    elif args.unverdicted:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT u.symbol
                    FROM app.universe u
                    JOIN app.cluster_assignment ca ON ca.symbol = u.symbol
                    LEFT JOIN (
                        SELECT DISTINCT symbol FROM app.stock_verdict
                    ) v ON v.symbol = u.symbol
                    WHERE u.is_active = true AND v.symbol IS NULL
                    ORDER BY u.symbol;
                """)
                symbols = [r[0] for r in cur.fetchall()]
        if not symbols:
            print("✓ All active stocks already have verdicts in app.stock_verdict.")
            return 0
    elif args.weekly_new_portfolio:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    WITH latest_batch AS (
                        SELECT MAX(created_at::date) AS d FROM app.stock_call
                    ),
                    candidates AS (
                        SELECT DISTINCT symbol
                        FROM app.portfolio_holding
                        WHERE quantity > 0
                        UNION
                        SELECT DISTINCT symbol
                        FROM app.stock_call
                        WHERE created_at::date = (SELECT d FROM latest_batch)
                    ),
                    latest_v AS (
                        SELECT DISTINCT ON (symbol) symbol, generated_at
                        FROM app.stock_verdict
                        ORDER BY symbol, generated_at DESC
                    )
                    SELECT c.symbol
                    FROM candidates c
                    LEFT JOIN latest_v v ON v.symbol = c.symbol
                    WHERE v.symbol IS NULL OR v.generated_at < now() - interval '7 days'
                    ORDER BY c.symbol;
                """)
                symbols = [r[0] for r in cur.fetchall()]
        if args.limit:
            symbols = symbols[:args.limit]
        if not symbols:
            print("✓ All weekly new calls and portfolio holdings already have fresh verdicts (< 7 days).")
            return 0
    elif args.claude_stocks:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT v.symbol
                    FROM (
                        SELECT DISTINCT symbol
                        FROM app.stock_verdict
                        WHERE (model ILIKE '%claude%' OR model ILIKE '%opus%' OR model ILIKE '%sonnet%' OR model IS NULL)
                    ) v
                    LEFT JOIN (
                        SELECT DISTINCT symbol FROM app.stock_verdict WHERE model ILIKE '%gemini%'
                    ) g ON g.symbol = v.symbol
                    LEFT JOIN (
                        SELECT DISTINCT symbol FROM app.portfolio_holding
                    ) p ON p.symbol = v.symbol
                    WHERE g.symbol IS NULL
                    ORDER BY (p.symbol IS NOT NULL) DESC, v.symbol;
                """)
                symbols = [r[0] for r in cur.fetchall()]
        if args.limit:
            symbols = symbols[:args.limit]
        if not symbols:
            print("✓ No Claude-only stocks found needing Gemini verdicts.")
            return 0
    elif args.drift:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        rel_thresh = 0.1
        abs_thresh = 0.05

        def check_moved(stored, live):
            if live is None or stored is None:
                return False
            if isinstance(stored, bool) or isinstance(live, bool):
                return bool(stored) != bool(live)
            try:
                a = float(stored)
                b = float(live)
            except Exception:
                return False
            if a == 0:
                return b != 0
            rel = abs(b / a - 1.0)
            is_rate = abs(a) <= 1.0 and abs(b) <= 1.0
            return abs(b - a) >= abs_thresh if is_rate else rel >= rel_thresh

        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    WITH latest_v AS (
                        SELECT DISTINCT ON (symbol) symbol, evidence, generated_at
                        FROM app.stock_verdict
                        ORDER BY symbol, generated_at DESC
                    ),
                    latest_m AS (
                        SELECT symbol, cluster_metrics
                        FROM app.metrics_snapshot
                        WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM app.metrics_snapshot)
                    )
                    SELECT v.symbol, v.evidence, m.cluster_metrics
                    FROM latest_v v
                    JOIN latest_m m ON m.symbol = v.symbol
                    WHERE v.evidence IS NOT NULL AND v.evidence != '{}'::jsonb
                    ORDER BY v.symbol;
                """)
                rows = cur.fetchall()
                drifted_syms = []
                for sym, ev, live in rows:
                    if not ev or not live:
                        continue
                    if any(check_moved(ev[k], live.get(k)) for k in ev if k in live):
                        drifted_syms.append(sym)
                symbols = drifted_syms
        if not symbols:
            print("✓ No stocks found with drifted evidence against the latest snapshot.")
            return 0
        print(f"🎯 Found {len(symbols)} stock(s) with evidence drift needing re-verdict.")
    elif args.portfolio:
        symbols = get_unverdicted_portfolio_symbols(limit=args.limit)
        if not symbols:
            print("✓ No un-verdicted portfolio stocks found.")
            return 0
    else:
        ap.error("Must specify --symbol, --symbols, --cluster, --since, --unverdicted, --drift, --portfolio, or --claude-stocks")

    if args.limit and len(symbols) > args.limit:
        symbols = symbols[:args.limit]

    total_target_count = len(symbols)

    # -------------------------------------------------------------------------
    # STAGE 1/4: Cohort Evidence Extraction
    # -------------------------------------------------------------------------
    print(f"[Stage 1/4] 📦 Extracting Audited Evidence Pack & Peer Cohort Rankings...")
    print(f"            Targeting {total_target_count} symbol(s) across cohort...")
    t_stage1 = time.time()
    pack_path = extract_evidence_pack(symbols)
    pack_data = json.loads(pack_path.read_text())
    pack_symbols = pack_data.get("symbols", [])
    snapshot_date = pack_data.get("sanity", {}).get("snapshot_date") or date.today().isoformat()
    price_asof = pack_data.get("sanity", {}).get("price_asof") or date.today().isoformat()
    dur_stage1 = time.time() - t_stage1
    print(f"            ✓ Extracted full financial pack in {dur_stage1:.2f}s (Pack: {pack_path.name})\n")

    # -------------------------------------------------------------------------
    # STAGE 2/4: Delta Screening & Queue Planning
    # -------------------------------------------------------------------------
    print(f"[Stage 2/4] 🔍 Database Screening & Queue Planning...")
    done_set = set()
    if args.skip_existing and not args.drift:
        import psycopg
        url = os.environ.get("APP_DB_URL", "postgres:///fundamental_app")
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                engine_kw = "gemini" if args.engine == "gemini" else "ollama"
                cur.execute("SELECT DISTINCT symbol FROM app.stock_verdict WHERE model ILIKE %s;", (f"%{engine_kw}%",))
                done_set = set(r[0] for r in cur.fetchall())

    queue_symbols = [item for item in pack_symbols if item.get("symbol") not in done_set]
    if args.limit and len(queue_symbols) > args.limit:
        queue_symbols = queue_symbols[:args.limit]

    skipped_count = total_target_count - len(queue_symbols)
    print(f"            • Total cluster stocks: {total_target_count}")
    print(f"            • Already in database:  {skipped_count} (skipped)")
    print(f"            • Queue to process:     {len(queue_symbols)} stock(s)\n")

    if not queue_symbols:
        print("✓ All requested symbols already have verdicts in app.stock_verdict. Nothing to do!")
        return 0

    # -------------------------------------------------------------------------
    # STAGE 3/4: LLM Inference & Verification Pipeline
    # -------------------------------------------------------------------------
    print("=" * 80)
    print(f"[Stage 3/4] ⚡ Running LLM Fundamental Verdict Inference Pipeline ({len(queue_symbols)} stocks)")
    print("=" * 80)

    results: list[dict] = []
    success_symbols: list[tuple[str, str, str]] = []
    failed_symbols: list[tuple[str, str]] = []
    durations: list[float] = []

    import threading
    from concurrent.futures import ThreadPoolExecutor

    print_lock = threading.Lock()
    completed_count = 0

    def process_item(idx_item):
        nonlocal completed_count
        idx, item = idx_item
        sym = item.get("symbol")
        t_stock_start = time.time()

        try:
            # Step 1: Prompt compilation
            prompt = format_symbol_evidence_prompt(item)

            # Step 2: LLM Inference
            t_llm = time.time()
            if args.engine == "gemini":
                verdict_obj, used_cand = call_gemini(args.model, prompt)
                verdict_obj["model"] = f"{used_cand} (cloud-gemini)"
                verdict_obj["source_report"] = "gemini-verdict-batch"
            else:
                verdict_obj = call_ollama(args.model, prompt)
                verdict_obj["model"] = f"{args.model} (local-ollama)"
                verdict_obj["source_report"] = "ollama-verdict-batch"
            llm_dur = time.time() - t_llm

            verdict_obj["snapshot_date"] = snapshot_date
            verdict_obj["price_asof"] = price_asof

            # Step 3: Validation & post-processing
            MODEL_KEYWORDS = ["piotroski", "altman", "beneish", "sloan", "dupont"]
            clean_pts = []
            for p in verdict_obj.get("points", []):
                p_low = p.lower()
                if (p_low.startswith("<b>the good") or p_low.startswith("<b>the bad")) and any(k in p_low for k in MODEL_KEYWORDS):
                    continue
                clean_pts.append(p)
            verdict_obj["points"] = clean_pts

            EVIDENCE_KEY_MAP = {
                "cfo_pat_3y_avg": "cfo_pat_3y",
                "cfo_pat": "cfo_pat_3y",
                "pe": "pe_ttm",
                "pe_ratio": "pe_ttm",
                "opm": "opm_now",
                "roce": "roce_3y",
                "net_debt": "net_debt_ebitda",
                "ttm_pat_pct": "ttm_np_pct",
                "ttm_net_profit_pct": "ttm_np_pct",
                "pat_cagr_5y": "np_cagr_5y",
                "sales_cagr_5y": "rev_cagr_5y",
            }
            metrics_dict = item.get("metrics") or {}
            cluster_metrics_dict = metrics_dict.get("cluster_metrics") or {}
            valid_keys = set(cluster_metrics_dict.keys()) | {
                "pe_band_lo", "pe_band_hi", "pe_band_avg", "pe_vs_own_history",
                "delivery_pct", "pledge_pct", "roce_3y", "roce_5y", "pe_ttm",
                "pb", "ev_ebitda_ttm", "cfo_pat_3y", "fcf_yield", "opm_now",
                "opm_prev", "ttm_op_pct", "ttm_sales_pct", "ttm_np_pct", "net_debt_ebitda"
            }
            if "evidence" in verdict_obj and isinstance(verdict_obj["evidence"], dict):
                norm_ev = {}
                for k, v in verdict_obj["evidence"].items():
                    norm_k = EVIDENCE_KEY_MAP.get(k, k)
                    if norm_k in valid_keys and isinstance(v, (int, float)):
                        norm_ev[norm_k] = v
                verdict_obj["evidence"] = norm_ev

            if not verdict_obj.get("evidence"):
                verdict_obj["evidence"] = {}
                m = item.get("metrics") or {}
                cm = m.get("cluster_metrics") or {}
                for k in ["pe_ttm", "roce_3y", "opm_now", "cfo_pat_3y", "net_debt_ebitda", "ttm_op_pct", "ttm_np_pct"]:
                    val = m.get(k) if m.get(k) is not None else cm.get(k)
                    if val is not None and isinstance(val, (int, float)):
                        verdict_obj["evidence"][k] = float(val)

            inst_models = evaluate_institutional_models(item)
            val_text = f"<b>Validated Parameters:</b> {inst_models['validated_parameters_text']}"
            pts = verdict_obj.get("points") or []
            has_val_param = any("validated parameters" in p.lower() for p in pts)
            if not has_val_param:
                pts.append(val_text)
            else:
                pts = [val_text if "validated parameters" in p.lower() else p for p in pts]
            verdict_obj["points"] = pts

            # Enforce backtest-backed deterministic accuracy guardrails
            guardrail_notes = apply_accuracy_guardrails(verdict_obj, item)
            if guardrail_notes:
                with print_lock:
                    print(f"            🛡️  {sym}: {' | '.join(guardrail_notes)}")

            # Second-stage Devil's Advocate Bear-Case Critic Pass (surviving ACCUMULATE/BUY only)
            if not args.no_critic:
                critic_note = run_devils_advocate_critic(verdict_obj, item, args.engine, args.model)
                if critic_note:
                    with print_lock:
                        print(f"            ⚖️  {sym}: {critic_note}")

            # Calculate institutional valuation targets AFTER guardrails & critic finalize the verdict action
            val_input = {**item, "verdict": verdict_obj.get("verdict")}
            val_res = calculate_stock_valuation(val_input)
            verdict_obj["target_price"] = val_res.get("target_price")
            verdict_obj["fair_value"] = val_res.get("fair_value")
            verdict_obj["buy_below"] = val_res.get("buy_below")
            verdict_obj["bear_floor"] = val_res.get("bear_floor")
            verdict_obj["upside_pct"] = val_res.get("upside_pct")
            verdict_obj["valuation_method"] = val_res.get("valuation_method")

            # Step 4: DB Load
            db_status = "Saved ✓"
            if args.load:
                tmp_single = Path(f"/tmp/v_{sym}_{int(datetime.now().timestamp())}_{idx}.json")
                tmp_single.write_text(json.dumps([verdict_obj], indent=2))
                load_cmd = [
                    str(ROOT / "etl" / ".venv" / "bin" / "python"),
                    str(ROOT / "scripts" / "verdict-load.py"),
                    str(tmp_single),
                    "--allow-no-evidence",
                ]
                res = subprocess.run(load_cmd, capture_output=True, text=True)
                if tmp_single.exists():
                    tmp_single.unlink(missing_ok=True)
                if res.returncode != 0:
                    db_status = f"Failed ✗ ({res.stderr[:80]})"
            else:
                db_status = "Dry-run (not saved)"

            stock_dur = time.time() - t_stock_start
            v_headline = verdict_obj.get("verdict", "No verdict")

            with print_lock:
                completed_count += 1
                results.append(verdict_obj)
                durations.append(stock_dur)
                avg_pace = sum(durations) / len(durations)
                rem_stocks = len(queue_symbols) - completed_count
                rem_sec = int(rem_stocks * (avg_pace / max(1, args.workers)))
                eta_str = f"{rem_sec // 60}m {rem_sec % 60}s" if rem_sec >= 60 else f"{rem_sec}s"
                pct = (completed_count / len(queue_symbols)) * 100
                success_symbols.append((sym, v_headline, verdict_obj.get("model", "")))
                elapsed_total = int(time.time() - start_total_time)

                print(f"\n[{completed_count}/{len(queue_symbols)}] ({pct:.1f}%) ── SYMBOL: {sym} ──")
                print(f"  ├─ 📊 [Step 1/4] Compiling 10Y financials & 9 institutional models... Done")
                print(f"  ├─ 🤖 [Step 2/4] Calling {args.engine.upper()} API ({args.model})... Done ({llm_dur:.2f}s)")
                print(f"  ├─ 🛡️ [Step 3/4] Validating parameters, checking syntax & filtering dilution... Done")
                print(f"  └─ 💾 [Step 4/4] Writing to database (app.stock_verdict)... {db_status}")
                print(f"      ✓ {sym}: {v_headline}")
                print(f"      ⏱️  Pace: {stock_dur:.1f}s | Avg: {avg_pace:.1f}s/stock | Elapsed: {elapsed_total}s | ETA: {eta_str}", flush=True)

            if args.delay and args.delay > 0:
                time.sleep(args.delay)

        except Exception as e:
            stock_dur = time.time() - t_stock_start
            with print_lock:
                completed_count += 1
                failed_symbols.append((sym, str(e)))
                print(f"[{completed_count}/{len(queue_symbols)}] ── {sym} ERROR after {stock_dur:.1f}s: {e}")

    items_to_process = list(enumerate(queue_symbols, 1))
    if args.workers > 1:
        print(f"⚡ Processing with {args.workers} concurrent worker threads...\n")
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            list(executor.map(process_item, items_to_process))
    else:
        for it in items_to_process:
            process_item(it)

    if args.out:
        out_file = Path(args.out)
        out_file.write_text(json.dumps(results, indent=2))
        print(f"\nSaved {len(results)} verdict(s) to {out_file}")

    # -------------------------------------------------------------------------
    # STAGE 4/4: Execution Summary & Links
    # -------------------------------------------------------------------------
    total_time = time.time() - start_total_time
    total_min = int(total_time // 60)
    total_sec = int(total_time % 60)

    print("\n" + "=" * 80)
    print("🏁 [Stage 4/4] EXECUTION SUMMARY & VERIFICATION REPORT")
    print("=" * 80)
    print(f"Total Target Stocks:      {total_target_count}")
    print(f"Already Loaded (Skipped): {skipped_count}")
    print(f"Processed This Run:       {len(queue_symbols)}")
    print(f"✓ Successfully Loaded:    {len(success_symbols)}")
    print(f"✗ Failed / Errored:       {len(failed_symbols)}")
    print(f"Total Elapsed Time:       {total_min}m {total_sec}s")
    if durations:
        print(f"Average Pace:             {sum(durations) / len(durations):.2f}s per stock")

    if failed_symbols:
        print("\nFailed Symbols:")
        for sym, err in failed_symbols:
            print(f"  • {sym}: {err}")

    if success_symbols:
        print("\nProcessed Stocks & Web Links:")
        for sym, v_head, mod in success_symbols:
            print(f"  • {sym:<12} http://localhost:3000/stock/{sym}  [{v_head}]")
    print("=" * 80 + "\n")

    return 0 if not failed_symbols else 1


if __name__ == "__main__":
    sys.exit(main())
