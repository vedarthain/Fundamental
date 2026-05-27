"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession, broadcastSessionChange } from "@/lib/session-client";
import { UserMenu } from "./UserMenu";

/**
 * Top-bar navigation.
 *
 * Two layouts share the same data:
 *   - md+ (desktop / tablet): inline nav with the "Tools" dropdown +
 *     UserMenu chip on the right. Same as before this commit.
 *   - <md  (mobile): a hamburger button only. The inline links wouldn't
 *     fit on a ~400px viewport (we tried — items crammed against the
 *     right edge and the user chip got squished). Tapping the hamburger
 *     opens a full-width sheet listing every link vertically.
 *
 * The Tools submenu items appear flattened in the mobile sheet — no
 * second-level dropdown, just the same items as a sub-list under a
 * "Tools" heading. Nobody wants nested taps on a phone.
 */

type Submenu = { href: string; label: string; description?: string };
type NavLink = { href: string; label: string; submenu?: Submenu[] };

const LINKS: NavLink[] = [
  { href: "/market",  label: "Market"  },
  { href: "/sectors", label: "Sectors" },
  { href: "/feed",    label: "Feed"    },
  { href: "/ideas",   label: "Ideas"   },
  {
    href: "/tools",
    label: "Tools",
    submenu: [
      { href: "/tools/screener",          label: "Stock Screener",     description: "Filter by criteria, see ranked matches" },
      { href: "/tools/investing-trials",  label: "Investing Trials",   description: "Set your own Q/V/M weights" },
      { href: "/tools/peer-comparison",   label: "Peer Comparison",    description: "Stack 2-5 stocks side by side" },
      { href: "/today",                   label: "Today's Signal",     description: "Auto-generated daily stock insight" },
      { href: "/feedback",                label: "Feedback",           description: "Tell us what to build next" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNavLinks() {
  const pathname = usePathname() ?? "";
  const { user, isAdmin, loading } = useSession();
  const showWatchlist = !loading && user !== null;
  const showSignIn = !loading && user === null;

  return (
    <>
      {/* ───── Desktop / tablet (md+) ─────────────────────────────── */}
      <nav className="hidden md:flex items-center gap-3 md:gap-6 text-[13px] md:text-[14px] shrink-0 ml-auto">
        {LINKS.map((l) =>
          l.submenu
            ? <NavDropdown key={l.href} link={l} active={isActive(pathname, l.href)} />
            : <NavLink key={l.href} href={l.href} label={l.label} active={isActive(pathname, l.href)} />
        )}
        {showWatchlist && (
          <NavLink href="/watchlist" label="Watchlist" active={isActive(pathname, "/watchlist")} />
        )}
        {showSignIn && (
          <NavLink href="/login" label="Sign in" active={isActive(pathname, "/login")} />
        )}
        {!loading && user !== null && (
          <UserMenu email={user.email} displayName={user.displayName} isAdmin={isAdmin} />
        )}
      </nav>

      {/* ───── Mobile (<md) ──────────────────────────────────────── */}
      <div className="md:hidden flex items-center gap-2 ml-auto">
        <MobileSheet
          pathname={pathname}
          user={user}
          isAdmin={isAdmin}
          showWatchlist={showWatchlist}
          showSignIn={showSignIn}
        />
      </div>
    </>
  );
}

// ── Desktop helpers (unchanged) ────────────────────────────────────────────

function NavLink({
  href, label, active, badge,
}: { href: string; label: string; active: boolean; badge?: number | null }) {
  return (
    <Link
      href={href}
      className={`relative pb-[3px] transition-colors inline-flex items-center gap-1.5 ${
        active
          ? "font-semibold text-[var(--color-accent-600)]"
          : "text-[var(--color-ink)] hover:text-[var(--color-accent-600)]"
      }`}
    >
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-semibold tabular-nums"
          style={{
            backgroundColor: "var(--color-accent-50)",
            color: "var(--color-accent-700)",
            border: "1px solid var(--color-accent-300)",
          }}
        >
          {badge}
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute left-0 right-0 -bottom-[2px] h-[2px] rounded-full"
          style={{ background: "var(--color-accent-600)" }}
        />
      )}
    </Link>
  );
}

function NavDropdown({ link, active }: { link: NavLink; active: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`relative pb-[3px] inline-flex items-center gap-1 transition-colors ${
          active
            ? "font-semibold text-[var(--color-accent-600)]"
            : "text-[var(--color-ink)] hover:text-[var(--color-accent-600)]"
        }`}
      >
        {link.label}
        <span aria-hidden className="text-[10px] mt-px opacity-70">▾</span>
        {active && (
          <span
            aria-hidden
            className="absolute left-0 right-[14px] -bottom-[2px] h-[2px] rounded-full"
            style={{ background: "var(--color-accent-600)" }}
          />
        )}
      </button>

      {open && link.submenu && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[280px] rounded-md border hairline shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          {link.submenu.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className="block px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors"
            >
              <div className="text-[13.5px] font-medium ink-text">{item.label}</div>
              {item.description && (
                <div className="text-[11.5px] muted-text mt-0.5 leading-snug">
                  {item.description}
                </div>
              )}
            </Link>
          ))}
          <Link
            href={link.href}
            role="menuitem"
            className="block px-4 py-2 border-t hairline text-[12px] hover:bg-[var(--color-paper)] transition-colors"
            style={{ color: "var(--color-accent-600)" }}
          >
            See all tools →
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Mobile sheet ───────────────────────────────────────────────────────────

type MobileSheetProps = {
  pathname: string;
  user: ReturnType<typeof useSession>["user"];
  isAdmin: boolean;
  showWatchlist: boolean;
  showSignIn: boolean;
};

function MobileSheet({ pathname, user, isAdmin, showWatchlist, showSignIn }: MobileSheetProps) {
  const [open, setOpen] = useState(false);
  const [purgeState, setPurgeState] = useState<"idle" | "running" | "ok" | "error">("idle");
  const router = useRouter();

  // Close on Escape (rare on mobile but cheap to support).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Close when route changes. The sheet links use <Link>, so pathname
  // updates on tap, which triggers this and clears the overlay.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll while sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function onSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    broadcastSessionChange();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  async function onPurgeCache() {
    setPurgeState("running");
    try {
      const r = await fetch("/api/revalidate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["sectors", "panel-cache", "market", "snapshot"] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setPurgeState("ok");
      router.refresh();
      setTimeout(() => setPurgeState("idle"), 2000);
    } catch {
      setPurgeState("error");
      setTimeout(() => setPurgeState("idle"), 3000);
    }
  }

  return (
    <>
      {/* Hamburger button — visible in the header */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-9 h-9 rounded-md border transition-colors"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7"  x2="20" y2="7"  />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        )}
      </button>

      {/* Full-screen sheet overlay.  Previously a right-side narrow drawer
          (w-84vw max-340px) — looked correct on paper but the body's
          background let the page bleed through on Safari iOS, leaving
          only the header visible. Full-screen with an explicit solid
          background avoids that whole class of layout race.  We use
          100dvh so it tracks the dynamic viewport (browser chrome
          collapse on scroll). */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex flex-col"
          style={{
            backgroundColor: "var(--color-card, #ffffff)",
            // 100dvh respects browser chrome; svh/lvh fallback for older
            // engines. CSS handles the cascade.
            height: "100dvh",
            minHeight: "100vh",
          }}
        >
            {/* Header inside the sheet */}
            <div
              className="px-4 py-3 border-b hairline flex items-center justify-between shrink-0"
              style={{ backgroundColor: "var(--color-card, #ffffff)" }}
            >
              <span className="font-display text-[16px]">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="w-9 h-9 rounded-md inline-flex items-center justify-center hover:bg-[var(--color-paper)] transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            {/* Scrollable body — explicit bg + min-height guard so an
                empty / pre-hydration state still looks intentional. */}
            <div
              className="flex-1 overflow-y-auto py-2"
              style={{ backgroundColor: "var(--color-card, #ffffff)", minHeight: 200 }}
            >
              {/* Primary links */}
              {LINKS.filter((l) => !l.submenu).map((l) => (
                <SheetLink key={l.href} href={l.href} label={l.label} active={isActive(pathname, l.href)} />
              ))}

              {/* Watchlist (signed in only) */}
              {showWatchlist && (
                <SheetLink href="/watchlist" label="Watchlist" active={isActive(pathname, "/watchlist")} />
              )}

              {/* Tools group — flattened, no nested dropdown */}
              {LINKS.filter((l) => l.submenu).map((l) => (
                <div key={l.href} className="mt-1 pt-2 border-t hairline">
                  <div className="px-4 pb-1 text-[10.5px] tracking-[0.12em] uppercase font-semibold muted-text">
                    {l.label}
                  </div>
                  {l.submenu!.map((item) => (
                    <SheetLink
                      key={item.href}
                      href={item.href}
                      label={item.label}
                      sublabel={item.description}
                      active={isActive(pathname, item.href)}
                    />
                  ))}
                </div>
              ))}

              {/* Auth section */}
              <div className="mt-1 pt-2 border-t hairline">
                {showSignIn ? (
                  <SheetLink href="/login" label="Sign in" active={isActive(pathname, "/login")} />
                ) : user ? (
                  <>
                    <div className="px-4 py-2">
                      <div className="text-[10.5px] tracking-[0.12em] uppercase font-semibold muted-text">
                        Signed in as
                      </div>
                      <div className="text-[13px] font-medium truncate">{user.email}</div>
                    </div>
                    {isAdmin && (
                      <>
                        <SheetLink
                          href="/admin/upstox"
                          label="Upstox session"
                          badge="ADMIN"
                          active={isActive(pathname, "/admin/upstox")}
                        />
                        <button
                          type="button"
                          onClick={onPurgeCache}
                          disabled={purgeState === "running"}
                          className="w-full text-left px-4 py-3 text-[14px] hover:bg-[var(--color-paper)] transition-colors flex items-center justify-between gap-2"
                        >
                          <span>
                            {purgeState === "running" ? "Purging cache…"
                              : purgeState === "ok"      ? "Cache purged ✓"
                              : purgeState === "error"   ? "Purge failed — retry"
                              : "Purge cache"}
                          </span>
                          {purgeState === "idle" && (
                            <span
                              className="inline-block px-1 py-0.5 rounded text-[9.5px] font-semibold tracking-wide uppercase"
                              style={{ backgroundColor: "var(--color-paper)", color: "var(--color-muted)" }}
                            >
                              Admin
                            </span>
                          )}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="w-full text-left px-4 py-3 text-[14px] hover:bg-[var(--color-paper)] transition-colors"
                      style={{ color: "var(--color-delta-down, #b00)" }}
                    >
                      Sign out
                    </button>
                  </>
                ) : null}
              </div>
            </div>
        </div>
      )}
    </>
  );
}

function SheetLink({
  href, label, sublabel, badge, active,
}: {
  href: string;
  label: string;
  sublabel?: string;
  badge?: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block px-4 py-3 transition-colors hover:bg-[var(--color-paper)] ${
        active ? "bg-[var(--color-paper)]" : ""
      }`}
      style={active ? { borderLeft: "3px solid var(--color-accent-600)", paddingLeft: 13 } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-[14px] ${active ? "font-semibold" : "font-medium"}`}
          style={active ? { color: "var(--color-accent-600)" } : undefined}
        >
          {label}
        </span>
        {badge && (
          <span
            className="inline-block px-1 py-0.5 rounded text-[9.5px] font-semibold tracking-wide uppercase"
            style={{ backgroundColor: "var(--color-paper)", color: "var(--color-muted)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {sublabel && (
        <div className="text-[11.5px] muted-text mt-0.5 leading-snug">{sublabel}</div>
      )}
    </Link>
  );
}
