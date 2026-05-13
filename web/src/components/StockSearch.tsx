"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { band, bandColor } from "@/lib/score";

type Hit = {
  symbol: string;
  company_name: string;
  industry_name: string | null;
  industry_id: string | null;
  composite_pct: number | null;
};

export function StockSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K to focus the search input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced fetch
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (!r.ok) throw new Error("search failed");
        const data: { hits: Hit[] } = await r.json();
        setHits(data.hits);
        setActive(0);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 130);
    return () => clearTimeout(t);
  }, [q]);

  const go = useCallback(
    (h: Hit | undefined) => {
      if (!h) return;
      setOpen(false);
      setQ("");
      router.push(`/stock/${h.symbol}`);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = open && q.trim().length > 0;

  const platform = useMemo(() => {
    if (typeof navigator === "undefined") return "ctrl";
    return navigator.platform.toLowerCase().includes("mac") ? "cmd" : "ctrl";
  }, []);

  return (
    <div ref={containerRef} className="relative w-[260px] sm:w-[320px]">
      <div className="flex items-center gap-2 px-3 h-9 rounded-md border hairline bg-[var(--color-card)] focus-within:border-[var(--color-accent-300)]">
        <Search size={14} className="muted-text shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Find a stock…"
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-muted)]"
          aria-label="Search stocks"
          autoComplete="off"
        />
        <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] muted-text font-mono">
          {platform === "cmd" ? "⌘" : "Ctrl"} K
        </kbd>
      </div>

      {showDropdown && (
        <div className="absolute top-[calc(100%+6px)] left-0 right-0 max-h-[420px] overflow-y-auto card shadow-md z-40">
          {loading && hits.length === 0 && (
            <div className="px-4 py-3 text-[12px] muted-text">Searching…</div>
          )}
          {!loading && hits.length === 0 && (
            <div className="px-4 py-3 text-[12px] muted-text">
              No matches for &ldquo;{q}&rdquo;
            </div>
          )}
          {hits.map((h, i) => {
            const b = band(h.composite_pct);
            const isActive = i === active;
            return (
              <button
                key={h.symbol}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`w-full text-left grid grid-cols-[1fr_44px] gap-3 px-4 py-2.5 border-b hairline last:border-b-0 transition-colors ${
                  isActive ? "bg-[var(--color-accent-50)]" : "hover:bg-[var(--color-paper)]"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium text-[13px] tabular-nums">{h.symbol}</div>
                  <div className="text-[12px] muted-text truncate">
                    {h.company_name}
                  </div>
                  {h.industry_name && (
                    <div className="text-[10px] muted-text mt-0.5 uppercase tracking-wide truncate">
                      {h.industry_name}
                    </div>
                  )}
                </div>
                {h.composite_pct != null && (
                  <span
                    className="self-center inline-flex items-center justify-center px-2 py-0.5 rounded-md tabular-nums text-[12px] font-medium"
                    style={{
                      backgroundColor: bandColor(b),
                      color: b === "neutral" ? "var(--color-ink)" : "white",
                    }}
                  >
                    {Math.round(h.composite_pct)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
