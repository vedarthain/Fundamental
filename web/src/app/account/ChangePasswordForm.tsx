"use client";

/**
 * Change-password form for the signed-in user. POSTs to
 * /api/auth/change-password, which requires the current password.
 */
import { useState } from "react";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data: { ok?: boolean; error?: string } = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || "Could not change password.");
        setBusy(false);
        return;
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6 text-center space-y-2">
        <div className="text-[14px] font-medium" style={{ color: "var(--color-accent-700)" }}>
          Password updated ✓
        </div>
        <p className="muted-text text-[12.5px]">
          Use your new password next time you sign in. This session stays active.
        </p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="text-[12px] underline muted-text"
        >
          Change it again
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-3">
      <Field
        label="Current password"
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <Field
        label="New password"
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        hint="At least 8 characters."
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
      {error && (
        <div className="text-[12px]" style={{ color: "var(--color-delta-down)" }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next || !confirm}
        className="w-full rounded-md px-3 py-2 text-[13px] font-medium text-white transition-colors disabled:opacity-40"
        style={{ backgroundColor: "var(--color-accent-600)" }}
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide muted-text">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-md border hairline bg-transparent px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-600)]"
      />
      {hint && <span className="text-[10.5px] muted-text mt-0.5 block">{hint}</span>}
    </label>
  );
}
