/**
 * The derived evidence sheet, rendered in the Verdict tab when no hand-written
 * verdict exists. Admin-only, by the same gate as VerdictPanel — and gated on
 * the QUERY in app/stock/[symbol]/page.tsx, not here.
 *
 * WHY THE HEADING IS THE FIRST THING AND WHY IT IS NOT A SUBTITLE
 *
 * "No verdict yet — here is what the data says." is load-bearing copy, not
 * decoration. This panel appears under the same tab, in the same card style, as
 * 384 hand-written verdicts, and a templated sheet inherits their authority for
 * free. That sentence is the only thing that stops a reader taking a rank table
 * as a recommendation, so it renders BEFORE any number — same type size as the
 * body, no muted grey, above the blocks rather than beside the symbol. Anyone
 * shortening it to fit a layout is removing the only disclaimer there is.
 *
 * WHY NO BADGE, NO COLOUR, NO CONFIDENCE ROW
 *
 * VerdictPanel colours its call by bucket (BUCKET_COLOR) because a human
 * committed to it. Nothing here may acquire that vocabulary: no coloured pill,
 * no up/down arrow, no "score", because each is a judgment the sheet is not
 * allowed to make and the reader would read one into the colour before reading
 * the heading. The table is deliberately plain.
 *
 * WHY THE WITHHELD LIST IS SHOWN AND NOT DROPPED
 *
 * "We did not show the operating-margin rank because 31 of 59 peers tie" is the
 * part a reader cannot reconstruct. Dropped, a withheld metric looks exactly
 * like a metric that does not exist. See 0088's comment on the column.
 *
 * sheet.py already explains most refusals in English in its own "What is
 * withheld, and why" block, so printing the whole `withheld` object underneath
 * would say everything twice. The list below therefore shows only the keys that
 * NO prose block mentions — which makes it self-maintaining in the right
 * direction: if the generator stops naming a key, the key reappears here rather
 * than vanishing. A hand-maintained exclusion list would have gone stale, which
 * is CLAUDE.md §5.
 *
 * WHY sheet.py's TEXT IS NOT PASSED TO dangerouslySetInnerHTML
 *
 * It carries <code> tags, and VerdictPanel does use dangerouslySetInnerHTML for
 * the hand-written `points`. The difference is the writer: those are typed by
 * the operator, whereas this text is assembled from pack fields and — via
 * `pack_blocker_*` — from strings the ETL generated. One escaping bug in the
 * pack builder would then be an injection. `inlineCode` below handles the only
 * tag the generator emits and renders everything else as text.
 *
 * Pure render over EvidenceSheetData. No database, no fetch, no state.
 */

import type { EvidenceSheetData, SheetBlock, SheetRankRow } from "@/lib/evidenceSheet";

function dateOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Render a generator string, honouring <code>…</code> and nothing else.
 *
 * Split, not parse: the only tag sheet.py emits is <code>, so anything else
 * that looks like markup is shown literally. That is the safe failure — a
 * reader seeing a stray tag knows the generator changed, whereas silently
 * interpreting it would mean the panel's escaping depends on the ETL's.
 */
function inlineCode(text: string): React.ReactNode[] {
  return text.split(/<code>|<\/code>/).map((part, i) =>
    i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>,
  );
}

/* ------------------------------------------------------------------- ranks */

/**
 * The peer-rank table. Rendered as a table and not as prose on purpose: prose
 * over thirty-seven measurements forces a choice of which to mention, and
 * choosing is the judgment a sheet is not allowed to make. A table can carry
 * all of them in no particular order of importance.
 */
function RankTable({ block }: { block: SheetBlock }) {
  const rows: SheetRankRow[] = block.rows ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[12.5px] font-semibold ink-text">
        {block.title}
        {block.cohort_n ? (
          <span className="ml-1 font-normal muted-text">
            — {block.cohort_n} peers in the cohort
          </span>
        ) : null}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left muted-text">
              <th className="py-1 pr-3 font-medium">Measure</th>
              <th className="py-1 pr-3 font-medium">Value</th>
              <th className="py-1 pr-3 font-medium">Rank</th>
              <th className="py-1 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.metric}
                className="border-t align-top"
                style={{ borderColor: "var(--color-border-subtle, var(--color-border-default))" }}
              >
                <td className="py-1.5 pr-3 ink-text">{r.label}</td>
                <td className="py-1.5 pr-3 ink-text tabular-nums">{r.value}</td>
                <td className="py-1.5 pr-3 muted-text tabular-nums">
                  {/* Always "15th of 34", never a bare "15th". The rank token
                      comes from sheet.py verbatim because check_sheet.py traced
                      it to a pack field; the denominator is appended here and
                      is not optional — an ordinal alone reads as a position in
                      the market rather than in a cohort of 34 names. */}
                  {r.rank != null && r.of != null ? `${r.rank} of ${r.of}` : "—"}
                </td>
                <td className="py-1.5 muted-text">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- panel */

export function EvidenceSheetPanel({ data }: { data: EvidenceSheetData }) {
  const prose = data.blocks.filter((b) => !b.rows && b.text);
  const rankBlocks = data.blocks.filter((b) => b.rows && b.rows.length > 0);
  const said = prose.map((b) => b.text ?? "").join(" ");
  const withheld = Object.entries(data.withheld).filter(
    ([key]) => !said.includes(key),
  );

  return (
    <div
      className="max-w-[760px] rounded-lg border p-5"
      style={{
        borderColor: "var(--color-border-default)",
        background: "var(--color-paper)",
      }}
    >
      {/* THE HEADING. Before any number. Do not shorten, do not mute, do not
          move below the blocks. See this file's header. */}
      <div className="text-[13px] font-semibold ink-text">
        No verdict yet — here is what the data says.
      </div>
      <p className="mt-2 text-[13px] muted-text leading-relaxed">
        Nobody has written a verdict for {data.symbol}. The lines below are
        generated from the same evidence pack a verdict is written from, by
        template, and state what was measured without concluding anything from
        it. There is no recommendation here, and the absence of one is not a
        neutral opinion.
      </p>

      {prose.map((b) => (
        <div key={b.title} className="mt-4">
          <div className="text-[12.5px] font-semibold ink-text">{b.title}</div>
          <p className="mt-1 text-[13px] ink-text leading-relaxed">
            {inlineCode(b.text ?? "")}
          </p>
        </div>
      ))}

      {rankBlocks.map((b) => (
        <RankTable key={b.title} block={b} />
      ))}

      {withheld.length > 0 ? (
        <div className="mt-4">
          <div className="text-[12.5px] font-semibold ink-text">
            Also recorded against this sheet
          </div>
          <ul className="mt-1 space-y-1">
            {withheld.map(([key, reason]) => (
              <li key={key} className="text-[12.5px] muted-text leading-relaxed">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className="mt-5 border-t pt-3 text-[11.5px] muted-text leading-relaxed"
        style={{ borderColor: "var(--color-border-default)" }}
      >
        Measured from the {dateOnly(data.snapshotDate)} score snapshot
        {data.priceAsof ? `, prices to ${dateOnly(data.priceAsof)}` : ""}. Rendered{" "}
        {dateOnly(data.generatedAt)} by <code>{data.generator}</code>, pack{" "}
        <code>{data.packSha.slice(0, 12)}</code>.
      </div>
    </div>
  );
}
