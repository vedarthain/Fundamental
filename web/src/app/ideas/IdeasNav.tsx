"use client";

/**
 * /ideas navigation — two rails, not one.
 *
 * WHY TWO COLUMNS AND NOT ONE LIST WITH SUBHEADINGS
 *
 * The previous single rail stacked "View" (2 entries) above "Trend" (4) above
 * "Themed" (4) above the universe pills. That reads as one 11-item list in which
 * the first two items happen to change what the other nine mean — a hierarchy
 * expressed only by a hairline. Splitting it puts the switch that changes the
 * page in its own column and the tabs *within* a page in the next, so the
 * relationship is structural rather than something the reader has to infer.
 *
 * WHY THE FIRST COLUMN COLLAPSES AND THE SECOND DOES NOT
 *
 * Two nested rails and "use the full page for data" pull against each other, and
 * the first column is where the slack is: there are exactly two views and the
 * reader knows which one they are on, so once chosen it is pure chrome — it
 * collapses to a 44px icon strip. The second column is the live control for the
 * current view (eight buckets or four statuses, with counts), so collapsing it
 * would hide the only thing on the page the reader is actually steering with.
 *
 * WHY THIS IS A CLIENT COMPONENT WHEN THE REST OF /ideas IS NOT
 *
 * Only for the collapse toggle. Every destination is still a real <Link> to a
 * server-rendered URL — no bucket's data is shipped to the client to be hidden
 * with CSS, which is the trap a client-side tab switcher would walk into on a
 * page where each tab is a different query. State survives soft navigation
 * because the component stays mounted at the same position across them.
 */

import { useState } from "react";
import Link from "next/link";
import { TrendingUp, Rocket, ChevronLeft, ChevronRight } from "lucide-react";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Optional on purpose: "no count" and "a count of zero" are different
   *  claims, and the view switch has no meaningful count. */
  n?: number;
  sub?: string;
  dot?: string;
};

export type NavGroup = { eyebrow: string; items: NavItem[] };
export type NavPill = { key: string; label: string; active: boolean; href: string };

/** Icons for the view column, keyed by view so the server never has to pass a
 *  React element across the boundary. */
const VIEW_ICON: Record<string, React.ReactNode> = {
  trends: <TrendingUp size={15} strokeWidth={2.2} />,
  ipo: <Rocket size={15} strokeWidth={2.2} />,
};

export function IdeasNav({
  views,
  groups,
  universe,
  contextLabel,
}: {
  views: NavItem[];
  groups: NavGroup[];
  /** Index-tier pills, or null on views the tier does not filter (the IPO
   *  tracker). A disabled universe control there would imply the snapshot is
   *  scoped to Nifty 50, which it is not. */
  universe: NavPill[] | null;
  /** Eyebrow for the second column — "Bucket" or "Status". Named by the caller
   *  because only the view knows what its own tabs are. */
  contextLabel: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      {/* Column 1 — the view switch. */}
      {open ? (
        <aside className="w-full md:w-[164px] md:shrink-0 md:sticky md:top-[84px]">
          <div className="flex items-center justify-between px-1 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide muted-text">View</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 hover:bg-[var(--color-border)] transition-colors muted-text"
              aria-label="Collapse view switch"
              title="Collapse"
            >
              <ChevronLeft size={13} strokeWidth={2.4} />
            </button>
          </div>
          <nav className="flex flex-col gap-1" role="tablist" aria-orientation="vertical">
            {views.map((v) => (
              <Link
                key={v.key}
                href={v.href}
                scroll={false}
                role="tab"
                aria-selected={v.active}
                className="rounded-lg px-2.5 py-2 border transition-colors block"
                style={
                  v.active
                    ? {
                        background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)",
                        borderColor: "color-mix(in srgb, var(--color-accent-600) 35%, transparent)",
                        color: "var(--color-accent-700)",
                      }
                    : { borderColor: "transparent", color: "var(--color-muted)" }
                }
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0">{VIEW_ICON[v.key]}</span>
                  <span className="text-[13px]" style={{ fontWeight: v.active ? 600 : 500 }}>
                    {v.label}
                  </span>
                </div>
                {v.sub && (
                  <div className="text-[10px] muted-text leading-tight mt-0.5 pl-[23px]">
                    {v.sub}
                  </div>
                )}
              </Link>
            ))}
          </nav>
        </aside>
      ) : (
        /* Collapsed: icons only, still navigable. A collapse that hides the
           destinations as well as their labels would make the reader expand it
           every time, which is just a slower expanded rail. */
        <aside className="shrink-0 self-start md:sticky md:top-[84px]">
          <div className="flex md:flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg border hairline p-1.5 hover:bg-[var(--color-paper)] transition-colors muted-text"
              aria-label="Expand view switch"
              title="Show views"
            >
              <ChevronRight size={13} strokeWidth={2.4} />
            </button>
            {views.map((v) => (
              <Link
                key={v.key}
                href={v.href}
                scroll={false}
                role="tab"
                aria-selected={v.active}
                title={v.label}
                aria-label={v.label}
                className="rounded-lg p-2 border transition-colors"
                style={
                  v.active
                    ? {
                        background: "color-mix(in srgb, var(--color-accent-600) 10%, transparent)",
                        borderColor: "color-mix(in srgb, var(--color-accent-600) 35%, transparent)",
                        color: "var(--color-accent-700)",
                      }
                    : { borderColor: "transparent", color: "var(--color-muted)" }
                }
              >
                {VIEW_ICON[v.key]}
              </Link>
            ))}
          </div>
        </aside>
      )}

      {/* Column 2 — the tabs within the chosen view. */}
      <aside className="w-full md:w-[206px] md:shrink-0 md:sticky md:top-[84px] md:border-l hairline md:pl-4">
        <div className="px-1 mb-1.5 text-[10px] uppercase tracking-wide muted-text">
          {contextLabel}
        </div>
        <nav className="flex flex-col gap-2" role="tablist" aria-orientation="vertical">
          {groups.map((g, gi) => (
            <div key={g.eyebrow}>
              {/* The eyebrow is suppressed when there is only one group: on the
                  IPO view the column header already says "Status", and repeating
                  it one line below is noise. */}
              {groups.length > 1 && (
                <div className="px-1 pb-1 text-[9.5px] uppercase tracking-wide muted-text opacity-70">
                  {g.eyebrow}
                </div>
              )}
              <div className={`flex flex-col gap-0.5 ${gi > 0 ? "" : ""}`}>
                {g.items.map((it) => (
                  <NavTab key={it.key} item={it} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        {universe && (
          <div className="mt-3 pt-3 border-t hairline">
            <div className="px-1 pb-1.5 text-[10px] uppercase tracking-wide muted-text">
              Universe
            </div>
            <div className="flex flex-wrap gap-1 px-1">
              {universe.map((p) => (
                <Link
                  key={p.key}
                  href={p.href}
                  scroll={false}
                  className="px-2 py-0.5 rounded-full text-[11px] border transition-colors whitespace-nowrap"
                  style={
                    p.active
                      ? {
                          borderColor: "var(--color-accent-300)",
                          backgroundColor: "var(--color-accent-50)",
                          color: "var(--color-accent-700)",
                          fontWeight: 600,
                        }
                      : {
                          borderColor: "var(--color-border-default)",
                          backgroundColor: "transparent",
                          color: "var(--color-muted)",
                        }
                  }
                >
                  {p.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function NavTab({ item }: { item: NavItem }) {
  return (
    <Link
      href={item.href}
      scroll={false}
      role="tab"
      aria-selected={item.active}
      className="rounded-lg px-2 py-1.5 transition-colors block"
      style={
        item.active
          ? { backgroundColor: "var(--color-accent-50)", color: "var(--color-accent-700)" }
          : { backgroundColor: "transparent", color: "var(--color-muted)" }
      }
    >
      <div className="flex items-center gap-2">
        {item.dot && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: item.dot }}
          />
        )}
        <span
          className="text-[12.5px] leading-tight flex-1 min-w-0"
          style={{ fontWeight: item.active ? 600 : 500 }}
        >
          {item.label}
        </span>
        {item.n != null && (
          <span className="tabular-nums text-[11px] muted-text shrink-0">{item.n}</span>
        )}
      </div>
      {item.sub && (
        <div className="text-[10px] muted-text leading-tight mt-0.5">{item.sub}</div>
      )}
    </Link>
  );
}
