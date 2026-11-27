"use client";

/**
 * UserMenu — the signed-in indicator + sign-out control in the top nav.
 *
 * Replaces the anonymous "Sign in" link once the user has a session.
 * Renders a circular initial badge (their email's first letter) that
 * expands on click into a dropdown showing account details, tools, and
 * a Sign out action.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { broadcastSessionChange } from "@/lib/session-client";
import { IDEAS_MENU_ITEMS } from "./TopNavLinks";

type Props = {
  email: string;
  displayName: string | null;
  /** Preserved for interface compatibility */
  isAdmin?: boolean;
};

export /** Small "Admin" pill rendered inside admin-only menu items. */
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

const TOOLS_MENU_ITEMS = [
  { href: "/tools", label: "All Tools" },
  { href: "/tools/screener", label: "Stock Screener" },
  { href: "/tools/scanner", label: "Scanner" },
  { href: "/tools/52-week-high-low", label: "52-Week High / Low" },
  { href: "/tools/alerts", label: "Alerts" },
  { href: "/tools/peer-comparison", label: "Peer Comparison" },
  { href: "/tools/universe-changes", label: "Universe Changes" },
  { href: "/feedback", label: "Feedback" },
];

export function UserMenu({ email, displayName }: Props) {
  const [open, setOpen] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
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

  async function onSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Cookie will still be cleared client-side via broadcast/refresh below
    }
    broadcastSessionChange();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  // Derive the badge initial from displayName first, then email.
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
        <span className="hidden xl:inline text-[12.5px] font-medium max-w-[140px] truncate">
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
            href="/dashboard"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
          >
            Home
          </Link>
          <Link
            href="/portfolio"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
          >
            Your portfolio
          </Link>
          <Link
            href="/watchlist"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
          >
            Your watchlist
          </Link>
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 hover:bg-[var(--color-paper)] transition-colors text-[13px]"
            title="Change your password"
          >
            Account settings
          </Link>

          {/* Collapsible Ideas section (under User) */}
          <div className="border-t hairline">
            <button
              type="button"
              onClick={() => setIdeasOpen((v) => !v)}
              aria-expanded={ideasOpen}
              className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-paper)] transition-colors text-[13px] font-medium"
            >
              <span>Ideas</span>
              <span
                aria-hidden
                className={`text-[10px] opacity-70 transition-transform duration-150 ${ideasOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
            {ideasOpen && (
              <div className="pb-1 bg-[var(--color-paper)]/50">
                {IDEAS_MENU_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => {
                      setIdeasOpen(false);
                      setOpen(false);
                    }}
                    className="block pl-7 pr-4 py-1.5 hover:bg-[var(--color-paper)] transition-colors text-[12.5px]"
                    title={item.description}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Collapsible Tools section (under User ID, matches Ideas) */}
          <div className="border-t hairline">
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
              className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-paper)] transition-colors text-[13px] font-medium"
            >
              <span>Tools</span>
              <span
                aria-hidden
                className={`text-[10px] opacity-70 transition-transform duration-150 ${toolsOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
            {toolsOpen && (
              <div className="pb-1 bg-[var(--color-paper)]/50">
                {TOOLS_MENU_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => {
                      setToolsOpen(false);
                      setOpen(false);
                    }}
                    className="block pl-7 pr-4 py-1.5 hover:bg-[var(--color-paper)] transition-colors text-[12.5px]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

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
