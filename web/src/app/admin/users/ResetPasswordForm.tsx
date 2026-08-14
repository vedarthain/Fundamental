"use client";

/**
 * Admin-only reset control. POSTs { email, newPassword } to
 * /api/admin/reset-password (server enforces the admin gate). The email
 * field can be pre-filled by clicking a "Reset" button on a user row.
 */
import { useState } from "react";

export function ResetPasswordForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    if (pw.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), newPassword: pw }),
      });
      const data: { ok?: boolean; email?: string; error?: string } = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || "Could not reset password.");
        setBusy(false);
        return;
      }
      setOkMsg(`Password reset for ${data.email}. Share it with them out-of-band.`);
      setPw("");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide muted-text">User email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 w-full rounded-md border hairline bg-transparent px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wide muted-text">New password</span>
          <input
            type="text"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="at least 8 chars"
            autoComplete="off"
            className="mt-1 w-full rounded-md border hairline bg-transparent px-2.5 py-1.5 text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
          />
        </label>
      </div>
      {error && (
        <div className="text-[12px]" style={{ color: "var(--color-delta-down)" }}>{error}</div>
      )}
      {okMsg && (
        <div className="text-[12px]" style={{ color: "var(--color-accent-700)" }}>{okMsg}</div>
      )}
      <button
        type="submit"
        disabled={busy || !email || !pw}
        className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
        style={{ backgroundColor: "var(--color-accent-600)" }}
      >
        {busy ? "Resetting…" : "Reset password"}
      </button>
      <p className="text-[10.5px] muted-text leading-relaxed">
        The new password is shown in plaintext here so you can copy it. It is
        stored bcrypt-hashed — this is the only moment it&apos;s visible.
      </p>
    </form>
  );
}
