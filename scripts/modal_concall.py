"""modal_concall.py — Serverless GPU Concall Summarizer on Modal (vLLM + Qwen2.5-32B-AWQ).

Deploys an on-demand L40S (48 GB VRAM) or A100-80GB container running vLLM with
temperature=0.0 and scales down to $0 after 60 seconds of idle time.

Setup & Deploy (one-time):
    pip install modal
    modal setup
    # Optional: modal secret create equityroots-concall CONCALL_API_TOKEN=<random-hex>
    modal deploy scripts/modal_concall.py

Once deployed, Modal prints an HTTPS endpoint URL:
    export MODAL_CONCALL_URL="https://<your-workspace>--equityroots-concall-summarizer-summarize.modal.run"
    etl/.venv/bin/python scripts/extract-concalls.py --engine modal --limit 50 --workers 4
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

try:
    import modal
except ImportError:
    modal = None  # type: ignore[assignment]

MODEL_ID = os.environ.get("MODAL_MODEL_ID", "Qwen/Qwen2.5-32B-Instruct-AWQ")
GPU_TYPE = os.environ.get("MODAL_GPU", "L40S")

SYSTEM_PROMPT = """You are a factual financial document analyst extracting comprehensive, segment-segregated management commentary from an Indian listed company's earnings conference call (concall) transcript.

STRICT COMPLIANCE & ANTI-HALLUCINATION RULES:
1. STRICTLY FACTUAL ONLY: Never output investment advice, never say BUY, SELL, HOLD, AVOID, or invent target prices.
2. VERBATIM QUOTE REQUIRED: Every single item in `numbers_mentioned`, `highlights`, and `qa_highlights` MUST include an exact, word-for-word `"quote"` copied directly from the provided transcript (10 to 45 words). Our pipeline programmatically verifies every quote against the PDF text and drops any item whose quote does not match!
3. EXHAUSTIVE & SEGREGATED: Do NOT omit important business segments or Q&A exchanges. Tag every item with its `"segment"` (e.g. "Consolidated", "O2C", "Jio Platforms", "Retail", "FMCG", "JioStar", "New Energy", "E&P", "IT Services", "BFSI", "Core Business", etc.). If a company has multiple verticals, cover ALL of them thoroughly.
4. ZERO EXTRAPOLATION: Never guess or compute numbers not explicitly spoken in the transcript.
5. QUARTER LABEL: Infer the fiscal quarter discussed (Indian FY format, e.g. "Q2 FY27" for Jul-Sep 2026, "Q1 FY27" for Apr-Jun 2026, "Q4 FY26" for Jan-Mar 2026).

Return ONLY valid JSON matching this exact schema:
{
  "quarter_label": "Q2 FY27",
  "tone": "Optimistic" | "Neutral" | "Cautious",
  "tone_rationale": "1-2 concise factual sentences explaining why management sounded optimistic, neutral, or cautious across segments.",
  "numbers_mentioned": [
    {
      "segment": "Business vertical, e.g. Consolidated / O2C / Jio Platforms / Retail / Core Business",
      "metric": "Short specific label, e.g. Consolidated EBITDA / Jio ARPU / New Energy Solar Module Target",
      "value": "Exact figure/range stated, e.g. ₹62,409 Cr (+24% YoY) or ₹218.8 (+3.5% YoY)",
      "quote": "Exact verbatim sentence from transcript containing this figure"
    }
  ],
  "highlights": [
    {
      "segment": "Business vertical, e.g. Consolidated / O2C / Jio Platforms / Retail / FMCG / New Energy / E&P",
      "category": "Guidance" | "Demand" | "Margins" | "Capex" | "Order Book" | "Risk",
      "point": "1 crisp factual sentence summarizing what management stated.",
      "quote": "Exact verbatim sentence from transcript supporting this point"
    }
  ],
  "qa_highlights": [
    {
      "segment": "Business vertical discussed, e.g. O2C / Retail / New Energy / Consolidated",
      "analyst": "Analyst Name & Firm if mentioned, e.g. Probal Sen (ICICI Securities)",
      "topic": "2-5 word topic, e.g. Refining Supply Normalization",
      "question": "1 sentence summarizing what the analyst asked",
      "answer": "1-2 sentences summarizing management's factual response",
      "quote": "Exact verbatim sentence from management's answer in the transcript"
    }
  ]
}"""


if modal is not None:
    hf_cache = modal.Volume.from_name("equityroots-hf-cache", create_if_missing=True)

    vllm_image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install("vllm>=0.6.4", "fastapi[standard]", "huggingface_hub[hf_transfer]")
        .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/root/.cache/huggingface"})
    )

    app = modal.App("equityroots-concall", image=vllm_image)

    @app.cls(
        gpu=GPU_TYPE,
        volumes={"/root/.cache/huggingface": hf_cache},
        scaledown_window=60,
        timeout=600,
        max_containers=6,
    )
    class ConcallSummarizer:
        @modal.enter()
        def load_model(self) -> None:
            from vllm import LLM, SamplingParams

            self.llm = LLM(
                model=MODEL_ID,
                quantization="awq" if "AWQ" in MODEL_ID.upper() else None,
                max_model_len=32768,
                gpu_memory_utilization=0.92,
                trust_remote_code=True,
            )
            self.sampling_params = SamplingParams(
                temperature=0.0,
                max_tokens=8192,
                repetition_penalty=1.03,
            )

        @modal.fastapi_endpoint(method="POST")
        def summarize(self, payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
            expected_tok = os.environ.get("CONCALL_API_TOKEN", "").strip()
            if expected_tok:
                given = (authorization or "").replace("Bearer ", "").strip()
                if given != expected_tok:
                    return {"ok": False, "error": "unauthorized"}

            symbol = str(payload.get("symbol", "")).strip()
            company_name = str(payload.get("company_name", symbol)).strip()
            title = str(payload.get("title", "")).strip()
            published_at = str(payload.get("published_at", "")).strip()
            transcript = str(payload.get("transcript_text", ""))[:160000]

            if len(transcript) < 2000:
                return {"ok": False, "error": "transcript_too_short"}

            user_prompt = (
                f"Company: {company_name} ({symbol})\n"
                f"Filing Title: {title}\n"
                f"Filing Date: {published_at}\n\n"
                f"--- BEGIN EARNINGS CALL TRANSCRIPT ---\n{transcript}\n--- END TRANSCRIPT ---\n\n"
                "Extract ALL material details segregated by business segment with exact verbatim quotes: "
                "all key numbers/KPIs/guidance (up to 25), all major commentary/drivers/capex/risks (up to 25), and all substantive analyst Q&A exchanges (up to 12)."
            )

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]
            outputs = self.llm.chat(messages=[messages], sampling_params=self.sampling_params)
            raw = outputs[0].outputs[0].text.strip()
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.S).strip()

            try:
                parsed = json.loads(raw)
            except Exception as e:
                m = re.search(r"\{.*\}", raw, flags=re.S)
                if not m:
                    return {"ok": False, "error": f"invalid_json: {e}", "raw": raw[:500]}
                parsed = json.loads(m.group(0))

            return {"ok": True, "model": MODEL_ID, "data": parsed}

    whisper_image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg")
        .pip_install("faster-whisper>=1.1.0", "yt-dlp", "fastapi[standard]")
        .env({"HF_HOME": "/root/.cache/huggingface"})
    )

    @app.cls(
        image=whisper_image,
        gpu="L4",
        volumes={"/root/.cache/huggingface": hf_cache},
        scaledown_window=60,
        timeout=900,
        max_containers=4,
    )
    class ConcallAudioTranscriber:
        @modal.enter()
        def load_whisper(self) -> None:
            from faster_whisper import WhisperModel

            self.whisper = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")

        @modal.fastapi_endpoint(method="POST")
        def transcribe(self, payload: dict[str, Any], authorization: str | None = None) -> dict[str, Any]:
            import shutil
            import subprocess
            import tempfile

            expected_tok = os.environ.get("CONCALL_API_TOKEN", "").strip()
            if expected_tok:
                given = (authorization or "").replace("Bearer ", "").strip()
                if given != expected_tok:
                    return {"ok": False, "error": "unauthorized"}

            media_url = str(payload.get("media_url", "")).strip()
            if not media_url:
                return {"ok": False, "error": "media_url_required"}

            tmp = tempfile.mkdtemp(prefix="concall_audio_")
            audio_out = os.path.join(tmp, "audio.mp3")
            try:
                subprocess.run(
                    [
                        "yt-dlp",
                        "--no-playlist",
                        "-x",
                        "--audio-format",
                        "mp3",
                        "--audio-quality",
                        "5",
                        "-o",
                        audio_out,
                        media_url,
                    ],
                    check=True,
                    timeout=300,
                )
                segments, info = self.whisper.transcribe(audio_out, beam_size=3, vad_filter=True)
                text = " ".join(seg.text.strip() for seg in segments).strip()
                return {
                    "ok": True,
                    "duration_sec": round(info.duration, 1),
                    "language": info.language,
                    "transcript_text": text,
                }
            except Exception as e:
                return {"ok": False, "error": str(e)}
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
