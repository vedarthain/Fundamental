"use client";

import { useState } from "react";
import AllStocksClient from "@/app/tools/scanner/AllStocksClient";
import type { AllStockRow } from "@/lib/allStocks";

// The universe toggle used to be page-level state in ScannerTabs, shared by all
// eight scanner tabs. All stocks no longer lives there, so it owns its own copy
// — one toggle, one consumer. Keep the labels identical to the scanner's rail:
// the same two words mean the same two universes everywhere on the site.
export default function StocksClient({
  snapDate,
  rows,
}: {
  snapDate: string | null;
  rows: AllStockRow[];
}) {
  const [n500Only, setN500Only] = useState(false);

  return (
    <div className="theme-indigo mx-auto max-w-[1560px] px-6 pt-10 pb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-[11px] uppercase tracking-wide muted-text">Universe</span>
        <div
          className="inline-flex items-center gap-1 rounded-lg p-1 border hairline"
          role="group"
          aria-label="Universe scope"
        >
          {([
            { on: false, label: "All NSE" },
            { on: true, label: "NIFTY 500" },
          ] as const).map((opt) => {
            const active = n500Only === opt.on;
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={active}
                onClick={() => setN500Only(opt.on)}
                className="px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors"
                style={
                  active
                    ? { background: "var(--color-accent-600)", color: "#fff" }
                    : { color: "var(--color-muted)" }
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <AllStocksClient snapDate={snapDate} rows={rows} n500Only={n500Only} />
    </div>
  );
}
