"use client";

/**
 * The credential form for /admin/screener.
 *
 * A client component only because it needs the two fields and the result
 * message; the gate, the status read and all the Screener traffic stay on the
 * server. In particular the password is POSTed as JSON to /api/screener/session
 * and is never put in a URL, never placed in a form action, and never kept after
 * the request resolves — the state is cleared on success so a left-open phone
 * tab holds nothing.
 */
import { useState } from "react";

type Result =
  | { kind: "ok"; symbol: string; bytes: number }
  | { kind: "err"; message: string };

export default function SessionForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/screener/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data?.ok) {
        setResult({ kind: "ok", symbol: data.verified_symbol, bytes: data.fragment_bytes });
        // Drop the credentials the moment they are no longer needed.
        setPassword("");
        setUsername("");
      } else {
        setResult({ kind: "err", message: String(data?.error ?? `HTTP ${res.status}`) });
      }
    } catch (err) {
      setResult({ kind: "err", message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block">
        <span className="muted-text text-[11px] tracking-wide uppercase">Screener email</span>
        <input
          type="email"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="mt-1 w-full rounded-md border px-3 py-2 text-[15px]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </label>
      <label className="block">
        <span className="muted-text text-[11px] tracking-wide uppercase">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-1 w-full rounded-md border px-3 py-2 text-[15px]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full px-5 py-3 rounded-md font-medium text-[15px] transition-colors disabled:opacity-60"
        style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
      >
        {busy ? "Logging in and verifying…" : "Log in and rotate session"}
      </button>

      {result?.kind === "ok" && (
        <p className="text-[13px] leading-snug" style={{ color: "#1f5a23" }}>
          Rotated. Verified against {result.symbol} ({result.bytes.toLocaleString()} byte Key
          Points fragment). Every Screener job picks it up on its next run — nothing else to do.
        </p>
      )}
      {result?.kind === "err" && (
        <p className="text-[13px] leading-snug" style={{ color: "#9c2a2a" }}>
          {result.message}
        </p>
      )}

      <p className="muted-text text-[11px] leading-snug pt-1">
        The password is used once to log in and is never stored — not here, not in the database,
        not in a log. Only the resulting session cookie is kept, and only after it has been
        proven against Screener&apos;s login-gated Key Points fragment.
      </p>
    </form>
  );
}
