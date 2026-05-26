"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { broadcastSessionChange } from "@/lib/session-client";
import { mergeLocalWatchlistIntoServer } from "@/lib/watchlist";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/watchlist";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Brief confirmation state so the user sees "signed in" before redirect.
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data: { ok?: boolean; error?: string } = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || "Could not sign in");
        setBusy(false);
        return;
      }
      // Best-effort: push any localStorage symbols up to the server.
      // Failure here is non-fatal; the user can re-add manually.
      await mergeLocalWatchlistIntoServer().catch(() => undefined);
      setSuccess(true);
      broadcastSessionChange();
      setTimeout(() => {
        router.push(next);
        router.refresh();
      }, 900);
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="card p-6 text-center space-y-3">
        <div
          className="inline-flex items-center justify-center w-12 h-12 rounded-full mx-auto"
          style={{ backgroundColor: "var(--color-accent-50, #ecfdf5)", color: "var(--color-accent-600, #059669)" }}
          aria-hidden
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div className="font-display text-[18px]">Signed in</div>
        <div className="muted-text text-[13px]">Taking you back…</div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div>
        <label className="block text-[12px] font-medium mb-1.5" htmlFor="email">Email</label>
        <input
          id="email" type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-md border text-[14px]"
          style={{ borderColor: "var(--color-border-default)" }}
        />
      </div>
      <div>
        <label className="block text-[12px] font-medium mb-1.5" htmlFor="password">Password</label>
        <input
          id="password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-md border text-[14px]"
          style={{ borderColor: "var(--color-border-default)" }}
        />
      </div>

      {error && (
        <div
          className="text-[12.5px] px-3 py-2 rounded-md"
          style={{ backgroundColor: "var(--color-delta-down-bg, #fee)", color: "var(--color-delta-down, #b00)" }}
        >
          {error}
        </div>
      )}

      <button
        type="submit" disabled={busy}
        className="w-full py-2.5 rounded-md font-medium text-[14px] transition-colors"
        style={{ backgroundColor: "var(--color-accent-600)", color: "white", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>

      <div className="text-center text-[12px] muted-text pt-1">
        No account?{" "}
        <Link
          href={`/signup${next !== "/watchlist" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="underline"
          style={{ color: "var(--color-accent-600)" }}
        >
          Create one
        </Link>
      </div>
    </form>
  );
}
