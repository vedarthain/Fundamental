"use client";

/**
 * Tab shell for /admin/verdicts. Holds nothing but which view is showing.
 *
 * Only the selected view is MOUNTED, not merely hidden with CSS. Each view
 * fetches the whole queue on mount, so rendering both and hiding one would pay
 * for two full queue requests on every page load to show one of them.
 *
 * The cost of that choice: switching tabs re-fetches. That is the right trade
 * at this size — the queue is admin-only and read a few times a day, and a
 * stale-by-minutes board is a worse failure than a second request.
 *
 * The Board stays the default. It is the view the admin work actually runs on;
 * Detail is for reading one stock's full call — chart, verdict, news — at a
 * time.
 *
 * The second tab used to be VerdictCardsClient (cards grouped by action). That
 * was a wrong first guess at this view and was replaced outright, not kept as
 * a third tab — see VerdictDetailClient's header for what actually replaced
 * it and why.
 */
import { useState } from "react";
import { VerdictQueueClient } from "./VerdictQueueClient";
import { VerdictDetailClient } from "./VerdictDetailClient";

type Tab = "board" | "detail";

export function VerdictTabs() {
  const [tab, setTab] = useState<Tab>("board");

  return (
    <div>
      <div className="flex items-center gap-1 mb-2">
        {(
          [
            ["board", "Board"],
            ["detail", "Detail"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`px-2.5 py-1 text-[12px] rounded-md border ${
              tab === key
                ? "bg-slate-800 text-white border-slate-800"
                : "hairline hover:bg-[var(--color-paper)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "board" ? <VerdictQueueClient /> : <VerdictDetailClient />}
    </div>
  );
}
