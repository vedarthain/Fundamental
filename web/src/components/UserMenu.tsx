"use client";

/**
 * UserMenu — the signed-in indicator + sign-out control in the top nav.
 *
 * Replaces the anonymous "Sign in" link once the user has a session.
 * Renders a circular initial badge (their email's first letter) that
 * expands on click into a dropdown showing the email and a Sign out
 * action.
 *
 * Visual treatment is intentionally distinct from the nav links — a
 * small chip rather than a text link — so the signed-in state reads
 * unambiguously from the corner of the eye. Without this, /watchlist
 * felt like a dead end ("am I even logged in?").
 *
 * Click-outside + Escape close the menu (same pattern as the Tools
 * dropdown).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { broadcastSessionChange } from "@/lib/session-client";

type Props = {
  email: string;
  displayName: string | null;
  /** Whether the er_admin cookie validates — surfaces admin-only links. */
  isAdmin?: boolean;
};

type PurgeState = "idle" | "running" | "ok" | "error";

export /** Small "Admin" pill rendered inside admin-only menu items. Stays a
 *  separate helper because the same chip appears in two siblings. */
function AdminBadge() {
  return (
    <span
      className="ml-1 inline-block px-1 py-0.5 rounded text-[9.5px] font-semibold tracking-wide uppercase align-middle"
      style={{ backgroundColor: "var(--color-paper)", color: "var(--color-muted)" }}
    >
      Admin
    </span>
  );
}

export function UserMenu({ email, displayName, isAdmin = false }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [purgeState, setPurgeState] = useState<PurgeState>("idle");
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function onPurgeCache() {
    setPurgeState("running");
    try {
      const r = await fetch("/api/revalidate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Purge every tag the live data layer carries. Cheap; just
        // rebuilds on next page render.
        body: JSON.stringify({
          tags: ["sectors", "panel-cache", "market", "snapshot"],
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPurgeState("ok");
      // Force a soft refresh of the current page so the user immediately
      // sees the result of the purge.
      router.refresh();
      // Reset the "ok" badge after 2s so the menu doesn't show it forever.
      setTimeout(() => setPurgeState("idle"), 2000);
    } catch {
      setPurgeState("error");
      setTimeout(() => setPurgeState("idle"), 3000);
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Cookie will still be cleared client-side via broadcast/refresh below
      // even if the server call fails; not worth blocking on.
    }
    broadcastSessionChange();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  // Derive the badge initial from displayName first, then email.  Falls
  // back to "?" for paranoia — never crash on a missing letter.
  const initial =
    (displayName?.trim()?.[0] ?? email?.trim()?.[0] ?? "?").toUpperCase();
  const shortLabel = displayName?.trim() || email;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full border transition-colors hover:bg-[var(--color-paper)]"
        style={{ borderColor: "var(--color-border-default)" }}
        title={`Signed in as ${email}`}
      >
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold"
          style={{
            backgroundColor: "var(--color-accent-600)",
            color: "white",
          }}
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden md:inline text-[12.5px] font-medium max-w-[140px] truncate">
          {shortLabel}
        </span>
        <span aria-hidden className="text-[10px] mt-px opacity-70">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[240px] rounded-md border hairline shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <div className="px-4 py-3 border-b hairline">
            <div className="text-[11px] muted-text">Signed in as</div>
            <div className="text-[13px] font-medium truncate" title={email}>
              {email}
            </div>
          </div>
          <Link
            href="/portfolio"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
          >
            Your portfolio
          </Link>
          <Link
            href="/watchlist"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
          >
            Your watchlist
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/admin/upstox"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px] border-t hairline"
                title="Admin · daily Upstox token reauth"
              >
                Upstox session{" "}
                <AdminBadge />
              </Link>
              <Link
                href="/admin/reports"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
                title="Admin · generate data exports"
              >
                Reports{" "}
                <AdminBadge />
              </Link>
              <button
                type="button"
                role="menuitem"
                disabled={purgeState === "running"}
                onClick={onPurgeCache}
                className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
                title="Admin · purge Next.js Data Cache so the next page render fetches fresh data"
              >
                {purgeState === "running"
                  ? "Purging cache…"
                  : purgeState === "ok"
                    ? "Cache purged ✓"
                    : purgeState === "error"
                      ? "Purge failed — retry"
                      : (
                        <>
                          Purge cache <AdminBadge />
                        </>
                      )}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={onSignOut}
            className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors text-[13px] border-t hairline"
            style={{ color: "var(--color-delta-down, #b00)", opacity: signingOut ? 0.6 : 1 }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
