"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWatchlist } from "@/lib/watchlist";

/**
 * Top-bar navigation links with active-state awareness.
 *
 * "Tools" is rendered as a dropdown — clicking opens a panel listing the three
 * sub-tools. Other entries are plain links. Clicking outside the dropdown
 * closes it; pressing Escape also closes; navigating closes via path change.
 *
 * Active treatment is intentionally strong (bold + accent color + 2px solid
 * underline) so the current page reads from the corner of the eye. For the
 * Tools entry, the same active treatment applies whenever the user is on any
 * /tools/* page or on the /tools landing.
 */

type Submenu = { href: string; label: string; description?: string };

type NavLink = {
  href: string;
  label: string;
  submenu?: Submenu[];
};

// Order matters — left to right in the header. Tools sits last as the
// "advanced features" umbrella; previously had a flat "Discover" link that
// pointed at the screener. Now the screener is one of three siblings under
// Tools, all reachable via this dropdown.
const LINKS: NavLink[] = [
  { href: "/sectors", label: "Sectors" },
  { href: "/feed",    label: "Feed"    },
  { href: "/ideas",   label: "Ideas"   },
  // /watchlist gets a count badge attached at render time (see TopNavLinks
  // component) so users see at a glance how many stocks they're tracking.
  { href: "/watchlist", label: "Watchlist" },
  {
    href: "/tools",
    label: "Tools",
    submenu: [
      {
        href: "/tools/screener",
        label: "Stock Screener",
        description: "Filter by criteria, see ranked matches",
      },
      {
        href: "/tools/investing-trials",
        label: "Investing Trials",
        description: "Set your own Q/V/M weights",
      },
      {
        href: "/tools/peer-comparison",
        label: "Peer Comparison",
        description: "Stack 2-5 stocks side by side",
      },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Match either an exact hit or a child route (e.g. /sectors/<id>,
  // /tools/screener, etc.)
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNavLinks() {
  const pathname = usePathname() ?? "";
  // Watchlist count badge — read client-side from localStorage.  During SSR
  // and first paint we render 0; once hydrated the real number appears.
  // Hidden when 0 to avoid clutter for users who haven't added any yet.
  const { count: watchCount, hydrated } = useWatchlist();
  return (
    <nav className="flex items-center gap-3 md:gap-6 text-[13px] md:text-[14px] shrink-0 ml-auto">
      {LINKS.map((l) =>
        l.submenu ? (
          <NavDropdown key={l.href} link={l} active={isActive(pathname, l.href)} />
        ) : (
          <NavLink
            key={l.href}
            href={l.href}
            label={l.label}
            active={isActive(pathname, l.href)}
            badge={l.href === "/watchlist" && hydrated && watchCount > 0 ? watchCount : null}
          />
        )
      )}
    </nav>
  );
}

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

  // Close on outside click. Click handler is attached to document so any
  // tap/click that lands outside the dropdown closes it. Listener is only
  // attached while the menu is open to avoid wasted work.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Close when navigation occurs (pathname changed).
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
