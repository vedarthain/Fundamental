import { sql } from "@/lib/db";

/**
 * Read-only "Competitive moat" summary for the stock About tab.
 * Reads app.company_moat (populated by scripts/generate_moat_points.py).
 * Renders nothing when the stock has no moat row or the table is unavailable.
 * Purely descriptive — no ratings/advice.
 */
export async function MoatCard({ symbol }: { symbol: string }) {
  let row:
    | { moat_strength: string; moat_type: string; moat_points: unknown }
    | undefined;
  try {
    const rows = await sql<
      { moat_strength: string; moat_type: string; moat_points: unknown }[]
    >`
      SELECT moat_strength, moat_type, moat_points
      FROM app.company_moat
      WHERE symbol = ${symbol}
      LIMIT 1
    `;
    row = rows[0];
  } catch {
    return null;
  }
  if (!row) return null;

  const raw = row.moat_points;
  const parsed: unknown = typeof raw === "string" ? safeParse(raw) : raw;
  const points: string[] = Array.isArray(parsed)
    ? parsed.map((p) => String(p)).filter(Boolean).slice(0, 5)
    : [];

  const strength = (row.moat_strength || "").trim();
  const badge =
    strength === "Wide"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : strength === "Narrow"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <section className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Competitive moat
        </h3>
        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${badge}`}>
          {strength || "—"}
        </span>
        {row.moat_type ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {row.moat_type}
          </span>
        ) : null}
      </div>
      {points.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-slate-700 dark:text-slate-300">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-[10px] text-slate-400">
        AI-generated summary · informational only, not advice.
      </p>
    </section>
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
