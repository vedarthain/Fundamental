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

SYSTEM_PROMPT = """You are a factual financial document analyst extracting structured management commentary from an Indian listed company's earnings conference call (concall) transcript.

STRICT COMPLIANCE & ANTI-HALLUCINATION RULES:
1. STRICTLY FACTUAL ONLY: Never output investment advice, never say BUY, SELL, HOLD, AVOID, or invent target prices.
2. VERBATIM QUOTE REQUIRED: Every single item in `highlights`, `numbers_mentioned`, and `qa_highlights` MUST include an exact, word-for-word `"quote"` copied directly from the provided transcript (12 to 45 words). Our pipeline programmatically verifies every quote against the PDF text and drops any item whose quote does not match!
3. ZERO EXTRAPOLATION: If guidance, capex, or order book was NOT discussed in the transcript, omit it. Never guess or compute numbers not explicitly spoken.
4. QUARTER LABEL: Infer the fiscal quarter discussed (Indian FY format, e.g. "Q2 FY27" for Jul-Sep 2026, "Q1 FY27" for Apr-Jun 2026, "Q4 FY26" for Jan-Mar 2026).

Return ONLY valid JSON matching this exact schema:
{
  "quarter_label": "Q2 FY27",
  "tone": "Optimistic" | "Neutral" | "Cautious",
  "tone_rationale": "1 concise factual sentence explaining why management sounded optimistic, neutral, or cautious.",
  "numbers_mentioned": [
    {
      "metric": "Short label, e.g. FY27 Revenue Growth Guidance / Order Book / Capex Plan",
      "value": "Exact figure/range stated, e.g. 15-18% YoY or ₹4,200 Cr",
      "quote": "Exact verbatim sentence from transcript containing this figure"
    }
  ],
  "highlights": [
    {
      "category": "Guidance" | "Demand" | "Margins" | "Capex" | "Order Book" | "Risk",
      "point": "1 crisp factual sentence summarizing what management stated.",
      "quote": "Exact verbatim sentence from transcript supporting this point"
    }
  ],
  "qa_highlights": [
    {
      "topic": "2-5 word topic, e.g. US Demand Recovery",
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
                max_tokens=3000,
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
            transcript = str(payload.get("transcript_text", ""))[:95000]

            if len(transcript) < 2000:
                return {"ok": False, "error": "transcript_too_short"}

            user_prompt = (
                f"Company: {company_name} ({symbol})\n"
                f"Filing Title: {title}\n"
                f"Filing Date: {published_at}\n\n"
                f"--- BEGIN EARNINGS CALL TRANSCRIPT ---\n{transcript}\n--- END TRANSCRIPT ---\n\n"
                "Extract the structured factual JSON with verbatim quotes (4-7 highlights, 2-5 numbers_mentioned, 2-4 qa_highlights)."
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
