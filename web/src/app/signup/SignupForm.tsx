"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { broadcastSessionChange } from "@/lib/session-client";
import { mergeLocalWatchlistIntoServer } from "@/lib/watchlist";

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/watchlist";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setBusy(false);
      return;
    }
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName.trim() || undefined,
        }),
      });
      const data: { ok?: boolean; error?: string } = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || "Could not create account");
        return;
      }
      await mergeLocalWatchlistIntoServer().catch(() => undefined);
      broadcastSessionChange();
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4">
      <div>
        <label className="block text-[12px] font-medium mb-1.5" htmlFor="displayName">
          Display name <span className="muted-text font-normal">(optional)</span>
        </label>
        <input
          id="displayName" type="text" autoComplete="nickname" maxLength={100}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded-md border text-[14px]"
          style={{ borderColor: "var(--color-border-default)" }}
        />
      </div>
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
        <label className="block text-[12px] font-medium mb-1.5" htmlFor="password">
          Password <span className="muted-text font-normal">(min 8 chars)</span>
        </label>
        <input
          id="password" type="password" required minLength={8} autoComplete="new-password"
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
        {busy ? "Creating account…" : "Create account"}
      </button>

      <div className="text-center text-[12px] muted-text pt-1">
        Already have one?{" "}
        <Link
          href={`/login${next !== "/watchlist" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="underline"
          style={{ color: "var(--color-accent-600)" }}
        >
          Sign in
        </Link>
      </div>
    </form>
  );
}
