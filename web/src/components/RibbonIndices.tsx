"use client";

import { useEffect, useState } from "react";
import type { IndexQuote } from "@/app/api/market-indices/route";

type IndicesData = {
  nifty: IndexQuote | null;
  bankNifty: IndexQuote | null;
};

function IndexPill({ quote }: { quote: IndexQuote }) {
  const up = quote.changePts >= 0;
  const color = up ? "#34d399" : "#fb7185";
  const sign = up ? "+" : "";
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
      <span className="kbd-label" style={{ color: "var(--color-strip-label)" }}>
        {quote.label}
      </span>
      <span className="num num-sm text-[11px] font-medium text-white">
        {quote.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
      </span>
      <span className="num num-sm text-[10.5px] font-semibold" style={{ color }}>
        ({sign}
        {quote.changePts.toFixed(1)})
      </span>
    </span>
  );
}

export function RibbonIndices() {
  const [data, setData] = useState<IndicesData | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/market-indices")
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (active && json) {
            setData({ nifty: json.nifty ?? null, bankNifty: json.bankNifty ?? null });
          }
        })
        .catch(() => {});
    };

    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!data || (!data.nifty && !data.bankNifty)) return null;

  return (
    <>
      {data.nifty && (
        <>
          <span
            aria-hidden
            className="h-3 w-px shrink-0"
            style={{ backgroundColor: "var(--color-strip-rule)" }}
          />
          <IndexPill quote={data.nifty} />
        </>
      )}
      {data.bankNifty && (
        <>
          <span
            aria-hidden
            className="h-3 w-px shrink-0"
            style={{ backgroundColor: "var(--color-strip-rule)" }}
          />
          <IndexPill quote={data.bankNifty} />
        </>
      )}
    </>
  );
}
