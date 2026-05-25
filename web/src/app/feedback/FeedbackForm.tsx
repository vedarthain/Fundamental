"use client";

/**
 * Submit form for /feedback.  Three fields:
 *   - body (required, min 10 chars, max 5000 chars)
 *   - name (optional)
 *   - email (optional, must look like an email if provided)
 *
 * Captures page_url at submit time from document.referrer when available,
 * else falls back to a query-string indicator if the user navigated here
 * via a CTA from another page (see usage in nav / stock cards).
 *
 * All state local; one POST to /api/feedback on submit.  No external deps.
 */

import { useState } from "react";

type Status = "idle" | "submitting" | "ok" | "error";

export function FeedbackForm() {
  const [body, setBody]   = useState("");
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim().length < 10) {
      setStatus("error");
      setErrMsg("Please give us a bit more detail (at least 10 characters).");
      return;
    }
    setStatus("submitting");
    setErrMsg("");
    try {
      const pageUrl = typeof document !== "undefined" ? document.referrer || "" : "";
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, name, email, page_url: pageUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      setStatus("ok");
      setBody("");
      setName("");
      setEmail("");
    } catch (e: unknown) {
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "Could not send. Try again?");
    }
  };

  // Success state — replace the form with a thank-you message but keep the
  // "send another" affordance so power users can fire multiple in a row.
  if (status === "ok") {
    return (
      <div className="card p-6">
        <div className="text-[18px] font-medium mb-1">Got it — thank you.</div>
        <p className="muted-text text-[13px] mb-4">
          We read every submission. If you left an email and we have a follow-up
          question, we&apos;ll be in touch.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="text-[12.5px] font-medium hover:underline"
          style={{ color: "var(--color-accent-700)" }}
        >
          Send another →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="fb-body" className="block text-[12px] font-medium muted-text mb-1.5">
          Your feedback <span style={{ color: "var(--color-delta-down)" }}>*</span>
        </label>
        <textarea
          id="fb-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's broken? What feature would make this 10× more useful for you?"
          rows={6}
          maxLength={5000}
          required
          className="w-full px-3 py-2 rounded-md border text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)] resize-y"
          style={{
            borderColor: "var(--color-border-default)",
            backgroundColor: "var(--color-card)",
            minHeight: "120px",
          }}
        />
        <div className="text-[10.5px] muted-text mt-0.5 text-right tabular-nums">
          {body.length} / 5000
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="fb-name" className="block text-[12px] font-medium muted-text mb-1.5">
            Your name <span className="font-normal">(optional)</span>
          </label>
          <input
            id="fb-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Optional"
            className="w-full px-3 py-2 rounded-md border text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)]"
            style={{
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
            }}
          />
        </div>
        <div>
          <label htmlFor="fb-email" className="block text-[12px] font-medium muted-text mb-1.5">
            Email <span className="font-normal">(optional, to follow up)</span>
          </label>
          <input
            id="fb-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            placeholder="you@example.com"
            className="w-full px-3 py-2 rounded-md border text-[14px] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-300)]"
            style={{
              borderColor: "var(--color-border-default)",
              backgroundColor: "var(--color-card)",
            }}
          />
        </div>
      </div>

      {status === "error" && (
        <div
          className="text-[12.5px] px-3 py-2 rounded-md border"
          style={{
            borderColor: "var(--color-delta-down)",
            backgroundColor: "color-mix(in srgb, var(--color-delta-down) 8%, transparent)",
            color: "var(--color-delta-down)",
          }}
        >
          {errMsg}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <p className="text-[11px] muted-text">
          By submitting, you agree we can read this. We won&apos;t share your contact info.
        </p>
        <button
          type="submit"
          disabled={status === "submitting"}
          className="px-4 py-2 rounded-md font-medium text-[13.5px] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            backgroundColor: "var(--color-accent-600)",
            color: "white",
          }}
        >
          {status === "submitting" ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  );
}
