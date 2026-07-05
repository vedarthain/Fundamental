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
 *
 *  - md+ (desktop / tablet): inline nav with the "Tools" dropdown +
 *    UserMenu chip on the right. Same as before this commit.
 *
 *  - <md  (mobile): a persistent 5-tab row directly below the logo +
 *    search bar (no hamburger). Layout in layout.tsx stacks logo /
 *    search / tabs as three rows. Order: Market | Segments | News |
 *    Tools | Account.
 *      • Market and News are direct-nav links (tap → navigate).
 *      • Segments, Tools, Account are popup dropdowns — tap opens a
 *        sheet of options anchored below the tab.
 *      • Ideas lives inside the Tools popup; Watchlist inside Account
 *        (account-specific data). Tabs flex to fit narrow phones.
 */

type Submenu = { href: string; label: string; description?: string };
type NavLink = { href: string; label: string; submenu?: Submenu[] };

const LINKS: NavLink[] = [
  { href: "/market",  label: "Market"  },
  {
    // Two complementary market-structure views under one tab.
    href: "/indices",
    label: "Segments",
    submenu: [
      { href: "/indices", label: "Indices", description: "Official NSE benchmarks + their constituents" },
      { href: "/sectors", label: "Sectors", description: "Our full-universe scoring view — every stock" },
    ],
  },
  { href: "/news",    label: "News"    },
  { href: "/ideas",   label: "Ideas"   },
  {
    href: "/tools",
    label: "Tools",
    submenu: [
      { href: "/tools/screener",          label: "Stock Screener",     description: "Filter by criteria, see ranked matches" },
      { href: "/tools/opportunities",     label: "Opportunities",      description: "Strong fundamentals that have sold off" },
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

const TOOLS_LINK = LINKS.find((l) => l.href === "/tools")!;

export function TopNavLinks() {
  const pathname = usePathname() ?? "";
  const { user, isAdmin, loading } = useSession();
  const showWatchlist = !loading && user !== null;
  const showSignIn = !loading && user === null;

  return (
    <>
      {/* ───── Desktop / tablet (md+) — unchanged ─────────────────── */}
      <nav className="hidden md:flex items-center gap-3 md:gap-6 text-[13px] md:text-[14px] shrink-0 ml-auto">
        {LINKS.map((l) => {
          const active = l.submenu
            ? isActive(pathname, l.href) || l.submenu.some((s) => isActive(pathname, s.href))
            : isActive(pathname, l.href);
          return l.submenu
            ? <DesktopDropdown key={l.href} link={l} active={active} />
            : <DesktopLink key={l.href} href={l.href} label={l.label} active={active} />;
        })}
        {showWatchlist && (
          <DesktopLink href="/watchlist" label="Watchlist" active={isActive(pathname, "/watchlist")} />
        )}
        {showSignIn && (
          <DesktopLink href="/login" label="Sign in" active={isActive(pathname, "/login")} />
        )}
        {!loading && user !== null && (
          <UserMenu email={user.email} displayName={user.displayName} isAdmin={isAdmin} />
        )}
      </nav>

      {/* ───── Mobile (<md) — persistent tab bar ──────────────────── */}
      <MobileTabBar
        pathname={pathname}
        user={user}
        isAdmin={isAdmin}
        showWatchlist={showWatchlist}
        showSignIn={showSignIn}
      />
    </>
  );
}

// ── Desktop helpers (unchanged) ────────────────────────────────────────────

function DesktopLink({
  href, label, active,
}: { href: string; label: string; active: boolean }) {
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

function DesktopDropdown({ link, active }: { link: NavLink; active: boolean }) {
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
          {link.href === "/tools" && (
            <Link
              href={link.href}
              role="menuitem"
              className="block px-4 py-2 border-t hairline text-[12px] hover:bg-[var(--color-paper)] transition-colors"
              style={{ color: "var(--color-accent-600)" }}
            >
              See all tools →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mobile tab bar ─────────────────────────────────────────────────────────

type MobileTabBarProps = {
  pathname: string;
  user: ReturnType<typeof useSession>["user"];
  isAdmin: boolean;
  showWatchlist: boolean;
  showSignIn: boolean;
};

type Popup = "segments" | "tools" | "account" | null;

function MobileTabBar({ pathname, user, isAdmin, showWatchlist, showSignIn }: MobileTabBarProps) {
  const [popup, setPopup] = useState<Popup>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close popup on outside-click.  We register one generic listener
  // typed as Event so the same handler can serve mousedown and
  // touchstart without an overload mismatch.
  useEffect(() => {
    if (popup === null) return;
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopup(null);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [popup]);

  // Close on Escape.
  useEffect(() => {
    if (popup === null) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setPopup(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [popup]);

  // Close on route change.
  useEffect(() => { setPopup(null); }, [pathname]);

  const segmentsActive = ["/indices", "/sectors"].some((p) => isActive(pathname, p));
  const toolsActive = isActive(pathname, "/tools") || isActive(pathname, "/ideas") || (TOOLS_LINK.submenu ?? []).some((s) => isActive(pathname, s.href));
  const accountActive = isActive(pathname, "/watchlist") || isActive(pathname, "/login") ||
                        isActive(pathname, "/admin");

  return (
    <div ref={ref} className="md:hidden relative">
      {/* The tab bar. Horizontally scrolls on very narrow phones; on
          most viewports (>360px) all five tabs fit comfortably. */}
      <div
        role="tablist"
        className="flex border-t hairline overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <TabLink  href="/market"  label="Market"  active={isActive(pathname, "/market")}  onClick={() => setPopup(null)} />
        <TabButton label="Segments" active={segmentsActive} isOpen={popup === "segments"} onClick={() => setPopup((p) => p === "segments" ? null : "segments")} />
        <TabLink  href="/news"    label="News"    active={isActive(pathname, "/news")}    onClick={() => setPopup(null)} />
        <TabButton label="Tools"   active={toolsActive}   isOpen={popup === "tools"}   onClick={() => setPopup((p) => p === "tools"   ? null : "tools"  )} />
        <TabButton label="Account" active={accountActive} isOpen={popup === "account"} onClick={() => setPopup((p) => p === "account" ? null : "account")} />
      </div>

      {popup && (
        <PopupSheet
          which={popup}
          onClose={() => setPopup(null)}
          pathname={pathname}
          user={user}
          isAdmin={isAdmin}
          showWatchlist={showWatchlist}
          showSignIn={showSignIn}
        />
      )}
    </div>
  );
}

const TAB_BASE_CLS =
  "flex-1 min-w-0 px-1.5 py-2.5 text-[12px] tracking-wide transition-colors whitespace-nowrap text-center";

function tabActiveStyle(): React.CSSProperties {
  return {
    color: "var(--color-accent-600)",
    boxShadow: "inset 0 -2px 0 var(--color-accent-600)",
  };
}

function TabLink({
  href, label, active, onClick,
}: { href: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`${TAB_BASE_CLS} ${active ? "font-semibold" : "font-medium muted-text"}`}
      style={active ? tabActiveStyle() : undefined}
    >
      {label}
    </Link>
  );
}

function TabButton({
  label, active, isOpen, onClick,
}: { label: string; active: boolean; isOpen: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className={`${TAB_BASE_CLS} ${active || isOpen ? "font-semibold" : "font-medium muted-text"} inline-flex items-center justify-center gap-1`}
      style={(active || isOpen) ? tabActiveStyle() : undefined}
    >
      {label}
      <span aria-hidden className="text-[9px] mt-px opacity-70">{isOpen ? "▴" : "▾"}</span>
    </button>
  );
}

// ── Mobile popup sheets ────────────────────────────────────────────────────

type PopupSheetProps = {
  which: "segments" | "tools" | "account";
  onClose: () => void;
  pathname: string;
  user: ReturnType<typeof useSession>["user"];
  isAdmin: boolean;
  showWatchlist: boolean;
  showSignIn: boolean;
};

function PopupSheet({
  which, onClose, pathname, user, isAdmin, showWatchlist, showSignIn,
}: PopupSheetProps) {
  const router = useRouter();
  const [purgeState, setPurgeState] = useState<"idle" | "running" | "ok" | "error">("idle");

  async function onSignOut() {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); }
    catch {}
    broadcastSessionChange();
    onClose();
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
    <div
      role="menu"
      className="absolute left-0 right-0 top-full z-[55] border-b hairline shadow-lg"
      style={{ backgroundColor: "var(--color-card, #ffffff)" }}
    >
      {which === "segments" && (
        <>
          <PopupLink href="/indices" label="Indices" sublabel="Official NSE benchmarks + constituents" active={isActive(pathname, "/indices")} onClose={onClose} />
          <PopupLink href="/sectors" label="Sectors" sublabel="Our full-universe scoring view — every stock" active={isActive(pathname, "/sectors")} onClose={onClose} />
        </>
      )}

      {which === "tools" && (
        <>
          <PopupLink
            href="/ideas"
            label="Ideas"
            sublabel="Auto-generated weekly stock ideas"
            active={isActive(pathname, "/ideas")}
            onClose={onClose}
          />
          {(TOOLS_LINK.submenu ?? []).map((item) => (
            <PopupLink
              key={item.href}
              href={item.href}
              label={item.label}
              sublabel={item.description}
              active={isActive(pathname, item.href)}
              onClose={onClose}
            />
          ))}
        </>
      )}

      {which === "account" && (
        <>
          {showSignIn && (
            <PopupLink href="/login" label="Sign in" active={isActive(pathname, "/login")} onClose={onClose} />
          )}
          {user && (
            <>
              <div className="px-4 py-3 border-b hairline">
                <div className="text-[10.5px] tracking-[0.12em] uppercase font-semibold muted-text">
                  Signed in as
                </div>
                <div className="text-[13.5px] font-medium truncate mt-0.5">{user.email}</div>
              </div>
              {showWatchlist && (
                <PopupLink
                  href="/watchlist"
                  label="Your watchlist"
                  sublabel="Stocks you're tracking"
                  active={isActive(pathname, "/watchlist")}
                  onClose={onClose}
                />
              )}
              {isAdmin && (
                <>
                  <PopupLink
                    href="/admin/upstox"
                    label="Upstox session"
                    sublabel="Daily Upstox API token reauth"
                    badge="ADMIN"
                    active={isActive(pathname, "/admin/upstox")}
                    onClose={onClose}
                  />
                  <button
                    type="button"
                    onClick={onPurgeCache}
                    disabled={purgeState === "running"}
                    className="w-full text-left px-4 py-3 hover:bg-[var(--color-paper)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-medium">
                        {purgeState === "running" ? "Purging cache…"
                          : purgeState === "ok"     ? "Cache purged ✓"
                          : purgeState === "error"  ? "Purge failed — retry"
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
                    </div>
                    <div className="text-[11.5px] muted-text mt-0.5 leading-snug">
                      Force a fresh server render of /market, /sectors and their data caches.
                    </div>
                  </button>
                </>
              )}
              <div className="border-t hairline">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="w-full text-left px-4 py-3 text-[14px] font-medium hover:bg-[var(--color-paper)] transition-colors"
                  style={{ color: "var(--color-delta-down, #b00)" }}
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PopupLink({
  href, label, sublabel, badge, active, onClose,
}: {
  href: string;
  label: string;
  sublabel?: string;
  badge?: string;
  active: boolean;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
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
