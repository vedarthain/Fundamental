"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Top-bar navigation links with active-state awareness.
 *
 * Previously the header rendered 4 plain Link tags with only a hover color —
 * no indication of which surface the user was on. usePathname() lets us mark
 * the active link so the user knows "I'm in Sectors" without having to look
 * at the URL.
 *
 * Active treatment is intentionally strong (bold + accent color + 2px solid
 * underline) so it reads from the corner of the eye, not just on inspection.
 */

const LINKS = [
  { href: "/sectors",  label: "Sectors"  },
  { href: "/discover", label: "Discover" },
  { href: "/feed",     label: "Feed"     },
  { href: "/ideas",    label: "Ideas"    },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Match either an exact hit or a child route (e.g. /sectors/<id>)
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNavLinks() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex items-center gap-3 md:gap-6 text-[13px] md:text-[14px] shrink-0 ml-auto">
      {LINKS.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`relative pb-[3px] transition-colors ${
              active
                ? "font-semibold text-[var(--color-accent-600)]"
                : "text-[var(--color-ink)] hover:text-[var(--color-accent-600)]"
            }`}
          >
            {l.label}
            {active && (
              <span
                aria-hidden
                className="absolute left-0 right-0 -bottom-[2px] h-[2px] rounded-full"
                style={{ background: "var(--color-accent-600)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
