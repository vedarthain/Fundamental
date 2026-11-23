"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession, broadcastSessionChange } from "@/lib/session-client";
import { UserMenu } from "./UserMenu";
import { ScribblePad } from "./ScribblePad";
import { QuickAddTradeButton } from "./ManualTradeSheet";

/**
 * Top-bar navigation.
 *
 * Two layouts share the same data:
 *
 *  - md+ (desktop / tablet): inline nav with Segments, News, Ideas,
 *    and conditional Admin dropdown (when isAdmin) + UserMenu chip on the right.
 *    Tools is integrated into UserMenu under the user account.
 *
 *  - <md  (mobile): a persistent tab row directly below the logo +
 *    search bar (no hamburger). Layout in layout.tsx stacks logo /
 *    search / tabs as three rows. Order: Segments | News | Ideas | Account (| Admin).
 *      • News is a direct-nav link (tap → navigate).
 *      • Segments, Ideas, Account, Admin are popup dropdowns.
 *      • Tools lives inside the Account popup.
 *      • Admin tab is only rendered when isAdmin === true.
 */

export type Submenu = { href: string; label: string; description?: string };
export type NavLink = { href: string; label: string; submenu?: Submenu[] };

const LINKS: NavLink[] = [
  {
    href: "/indices",
    label: "Segments",
    submenu: [
      { href: "/indices", label: "Indices", description: "Official NSE benchmarks + their constituents" },
      { href: "/sectors", label: "Sectors", description: "Our full-universe scoring view — every stock" },
      { href: "/industries", label: "Industries", description: "Every cluster in one filterable list — find one without knowing its sector" },
      { href: "/stocks", label: "All Stocks", description: "The full scored universe in one sortable table — price, returns, composite, peer rank" },
      { href: "/themes",  label: "Themes",  description: "Defence, Drone, Data Center, Green Hydrogen — groupings no industry tree can express" },
      { href: "/ipo",     label: "IPO Tracker", description: "Mainboard and SME issues — open, upcoming, closed and recently listed" },
    ],
  },
  { href: "/news",    label: "News"    },
  {
    href: "/ideas",
    label: "Ideas",
    submenu: [
      { href: "/ideas", label: "Trends", description: "Scored weekly ideas — compounders, breakouts, and value in clusters" },
      { href: "/ideas?view=results", label: "Results Corner", description: "Declared quarterly results for NSE stocks sorted by date" },
      { href: "/ideas?view=dividends", label: "Dividend Corner", description: "Dividend-paying stocks, high yields, consistency record, and upcoming payouts" },
    ],
  },
];

export const TOOLS_MENU_ITEMS: Submenu[] = [
  { href: "/tools/screener",         label: "Stock Screener",   description: "Filter by criteria, see ranked matches" },
  { href: "/tools/scanner",          label: "Scanner",          description: "Igniting today, trend leaders, fallen leaders" },
  { href: "/tools/alerts",           label: "Alerts",           description: "Holdings that need a look + your price alerts" },
  { href: "/tools/peer-comparison",  label: "Peer Comparison",  description: "Stack 2-5 stocks side by side" },
  { href: "/tools/universe-changes", label: "Universe Changes", description: "Weekly log of stocks added & removed" },
  { href: "/feedback",               label: "Feedback",         description: "Tell us what to build next" },
];

export const ADMIN_MENU_ITEMS: Submenu[] = [
  { href: "/admin/calls",       label: "Calls Desk",         description: "Verdicts, Portfolio Sweep & Calls Desk" },
  { href: "/admin/reports",     label: "Report Extraction",  description: "Customizable Data & Metrics CSV Extractor" },
  { href: "/admin/logs",        label: "Cron Logs",          description: "Server Cron & Pipeline Execution Logs" },
  { href: "/admin/insights",    label: "Site Insights",      description: "Real-User Speed Vitals, Slow Routes & Traffic" },
  { href: "/admin/upstox",      label: "Upstox Session",     description: "Daily Upstox API token reauth" },
  { href: "/admin/screener",    label: "Screener Session",   description: "Rotate the Screener.in session cookie" },
  { href: "/admin/users",       label: "User Accounts",      description: "Manage registered user accounts & access" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const SEGMENTS_LINK = LINKS.find((l) => l.label === "Segments")!;
const SEGMENTS_ITEMS = SEGMENTS_LINK.submenu ?? [];

export function TopNavLinks() {
  const pathname = usePathname() ?? "";
  const { user, isAdmin, loading } = useSession();
  const showWatchlist = !loading && user !== null;
  const showSignIn = !loading && user === null;

  return (
    <>
      {/* ───── Desktop (lg+) ──────────────────────────────────────── */}
      <nav className="hidden lg:flex items-center gap-3 lg:gap-6 text-[13px] lg:text-[14px] shrink-0 ml-auto">
        {LINKS.map((l) => {
          const active = l.submenu
            ? isActive(pathname, l.href) || l.submenu.some((s) => isActive(pathname, s.href))
            : isActive(pathname, l.href);
          return l.submenu
            ? <DesktopDropdown key={l.href} link={l} active={active} />
            : <DesktopLink key={l.href} href={l.href} label={l.label} active={active} />;
        })}

        {/* Dedicated Admin dropdown tab — only rendered when authenticated user is an admin */}
        {!loading && isAdmin && (
          <DesktopAdminDropdown active={isActive(pathname, "/admin")} />
        )}

        {showWatchlist && (
          <DesktopLink href="/portfolio" label="Portfolio" active={isActive(pathname, "/portfolio")} />
        )}
        {showWatchlist && (
          <DesktopLink href="/watchlist" label="Watchlist" active={isActive(pathname, "/watchlist")} />
        )}
        {showSignIn && (
          <DesktopLink href="/login" label="Sign in" active={isActive(pathname, "/login")} />
        )}
        {!loading && user !== null && <QuickAddTradeButton />}
        {!loading && user !== null && <ScribblePad />}
        {!loading && user !== null && (
          <UserMenu email={user.email} displayName={user.displayName} isAdmin={isAdmin} />
        )}
      </nav>

      {/* ───── Mobile (<lg) — persistent tab bar ──────────────────── */}
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

// ── Desktop helpers ────────────────────────────────────────────────────────

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
              onClick={() => setOpen(false)}
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
        </div>
      )}
    </div>
  );
}

function DesktopAdminDropdown({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [purgeState, setPurgeState] = useState<"idle" | "running" | "ok" | "error">("idle");
  const pathname = usePathname();
  const router = useRouter();
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
        <span>Admin</span>
        <span aria-hidden className="text-[10px] mt-px opacity-70">▾</span>
        {active && (
          <span
            aria-hidden
            className="absolute left-0 right-[14px] -bottom-[2px] h-[2px] rounded-full"
            style={{ background: "var(--color-accent-600)" }}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[290px] rounded-md border hairline shadow-lg z-50 overflow-hidden"
          style={{ backgroundColor: "var(--color-card)" }}
        >
          <div className="px-4 py-2 border-b hairline bg-[var(--color-paper)]/50">
            <span className="text-[10.5px] font-semibold tracking-wider uppercase muted-text">
              Administration
            </span>
          </div>
          {ADMIN_MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
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
          <button
            type="button"
            role="menuitem"
            disabled={purgeState === "running"}
            onClick={onPurgeCache}
            className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-paper)] transition-colors border-t hairline"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-medium ink-text">
                {purgeState === "running" ? "Purging cache…"
                  : purgeState === "ok"     ? "Cache purged ✓"
                  : purgeState === "error"  ? "Purge failed — retry"
                  : "Purge Cache"}
              </span>
            </div>
            <div className="text-[11.5px] muted-text mt-0.5 leading-snug">
              Force fresh server render of /indices, /sectors and caches
            </div>
          </button>
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

type Popup = "segments" | "ideas" | "account" | "admin" | null;

function MobileTabBar({ pathname, user, isAdmin, showWatchlist, showSignIn }: MobileTabBarProps) {
  const [popup, setPopup] = useState<Popup>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close popup on outside-click.
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

  const segmentsActive = SEGMENTS_ITEMS.some((s) => isActive(pathname, s.href));
  const ideasActive = isActive(pathname, "/ideas");
  const accountActive = isActive(pathname, "/watchlist") || isActive(pathname, "/portfolio") ||
                        isActive(pathname, "/dashboard") ||
                        isActive(pathname, "/login") || isActive(pathname, "/account") ||
                        TOOLS_MENU_ITEMS.some((s) => isActive(pathname, s.href));
  const adminActive = isActive(pathname, "/admin");

  return (
    <div ref={ref} className="lg:hidden relative">
      <div
        role="tablist"
        className="flex border-t hairline overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <TabButton label="Segments" active={segmentsActive} isOpen={popup === "segments"} onClick={() => setPopup((p) => p === "segments" ? null : "segments")} />
        <TabLink  href="/news"     label="News"     active={isActive(pathname, "/news")}    onClick={() => setPopup(null)} />
        <TabButton label="Ideas"    active={ideasActive}    isOpen={popup === "ideas"}    onClick={() => setPopup((p) => p === "ideas"    ? null : "ideas"   )} />
        <TabButton label="Account"  active={accountActive}  isOpen={popup === "account"}  onClick={() => setPopup((p) => p === "account"  ? null : "account" )} />
        {isAdmin && (
          <TabButton label="Admin"  active={adminActive}    isOpen={popup === "admin"}    onClick={() => setPopup((p) => p === "admin"    ? null : "admin"   )} />
        )}
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
  which: "segments" | "ideas" | "account" | "admin";
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
      className="absolute left-0 right-0 top-full z-[55] border-b hairline shadow-lg max-h-[calc(100dvh-130px)] overflow-y-auto"
      style={{ backgroundColor: "var(--color-card, #ffffff)" }}
    >
      {which === "segments" && (
        <>
          {SEGMENTS_ITEMS.map((item) => (
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

      {which === "ideas" && (
        <>
          <PopupLink
            href="/ideas"
            label="Trends"
            sublabel="Compounders, breakouts, and value in clusters"
            active={pathname === "/ideas"}
            onClose={onClose}
          />
          <PopupLink
            href="/ideas?view=results"
            label="Results Corner"
            sublabel="Declared quarterly results for NSE stocks sorted by date"
            active={pathname.startsWith("/ideas") && pathname.includes("results")}
            onClose={onClose}
          />
          <PopupLink
            href="/ideas?view=dividends"
            label="Dividend Corner"
            sublabel="Dividend-paying stocks, high yields, consistency record & payouts"
            active={pathname.startsWith("/ideas") && pathname.includes("dividends")}
            onClose={onClose}
          />
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
                  href="/dashboard"
                  label="Home"
                  sublabel="Equity book"
                  active={isActive(pathname, "/dashboard")}
                  onClose={onClose}
                />
              )}
              {showWatchlist && (
                <PopupLink
                  href="/portfolio"
                  label="Your portfolio"
                  sublabel="Broker holdings, valued & scored"
                  active={isActive(pathname, "/portfolio")}
                  onClose={onClose}
                />
              )}
              {showWatchlist && (
                <PopupLink
                  href="/watchlist"
                  label="Your watchlist"
                  sublabel="Stocks you're tracking"
                  active={isActive(pathname, "/watchlist")}
                  onClose={onClose}
                />
              )}
              <PopupLink
                href="/account"
                label="Account settings"
                sublabel="Change your password"
                active={isActive(pathname, "/account")}
                onClose={onClose}
              />

              {/* Tools Section */}
              <div className="px-4 pt-3 pb-1.5 border-t hairline bg-[var(--color-paper)]/40">
                <div className="text-[10px] font-semibold tracking-wider uppercase muted-text">
                  Tools
                </div>
              </div>
              {TOOLS_MENU_ITEMS.map((item) => (
                <PopupLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  sublabel={item.description}
                  active={isActive(pathname, item.href)}
                  onClose={onClose}
                />
              ))}

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

      {which === "admin" && (
        <>
          <div className="px-4 py-3 border-b hairline bg-[var(--color-paper)]/50">
            <div className="text-[10.5px] tracking-[0.12em] uppercase font-semibold muted-text">
              Admin Controls
            </div>
          </div>
          {ADMIN_MENU_ITEMS.map((item) => (
            <PopupLink
              key={item.href}
              href={item.href}
              label={item.label}
              sublabel={item.description}
              badge="ADMIN"
              active={isActive(pathname, item.href)}
              onClose={onClose}
            />
          ))}
          <button
            type="button"
            onClick={onPurgeCache}
            disabled={purgeState === "running"}
            className="w-full text-left px-4 py-3 hover:bg-[var(--color-paper)] transition-colors border-t hairline"
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
              Force a fresh server render of /indices, /sectors and their data caches.
            </div>
          </button>
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
