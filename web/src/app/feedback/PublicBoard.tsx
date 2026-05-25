/**
 * Public roadmap board on /feedback.
 *
 * Renders anonymised, admin-approved submissions grouped by status.
 * Privacy: NEVER receives name/email/IP/UA/page_url — the parent page
 * only SELECTs id/body/status/response from the DB.
 *
 * Status visual language matches the admin dropdown so users can map
 * "Building" here to what they see admin-side.
 */

export type PublicIdea = {
  id: number;
  submitted_at: string;
  body: string;
  status: string;
  response: string | null;
};

type StatusMeta = {
  label: string;
  emoji: string;
  // Tier colour palette to match /sectors + admin dropdown
  bg: string;
  border: string;
  fg: string;
};

const STATUS_META: Record<string, StatusMeta> = {
  shipped:  { label: "Shipped",   emoji: "🚀", bg: "rgba(46,154,71,0.08)",  border: "#2e9a47", fg: "#206b32" },
  building: { label: "Building",  emoji: "🔨", bg: "rgba(192,142,44,0.10)", border: "#c08e2c", fg: "#8a6116" },
  planned:  { label: "Planned",   emoji: "📋", bg: "rgba(58,146,144,0.08)", border: "#3a9290", fg: "#236663" },
  open:     { label: "Under review", emoji: "💡", bg: "rgba(120,130,184,0.08)", border: "#7882b8", fg: "#3f4978" },
  wont_do:  { label: "Not planned", emoji: "—", bg: "var(--color-paper)", border: "var(--color-border-default)", fg: "var(--color-muted)" },
};

// Order matters — top-to-bottom on the page.
const STATUS_ORDER = ["shipped", "building", "planned", "open", "wont_do"];

export function PublicBoard({ ideas }: { ideas: PublicIdea[] }) {
  // Bucket by status, preserving input order within each bucket (which
  // the SQL already sorted by submitted_at DESC).
  const byStatus = new Map<string, PublicIdea[]>();
  for (const idea of ideas) {
    const s = STATUS_META[idea.status] ? idea.status : "open";
    if (!byStatus.has(s)) byStatus.set(s, []);
    byStatus.get(s)!.push(idea);
  }
  const visibleStatuses = STATUS_ORDER.filter((s) => byStatus.has(s));

  return (
    <section className="mt-12 pt-8 border-t hairline">
      <header className="mb-6">
        <h2 className="font-display text-[20px] md:text-[22px] tracking-tight">
          What other people have asked for
        </h2>
        <p className="muted-text text-[12.5px] mt-1">
          Anonymised. Status reflects what we&apos;re actively working on.
        </p>
      </header>

      <div className="space-y-6">
        {visibleStatuses.map((status) => {
          const bucket = byStatus.get(status)!;
          const meta = STATUS_META[status];
          return (
            <section key={status}>
              <h3
                className="flex items-center gap-2 text-[12px] uppercase tracking-wide font-semibold mb-3"
                style={{ color: meta.fg }}
              >
                <span className="text-[14px]">{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className="muted-text tabular-nums font-normal normal-case">
                  · {bucket.length}
                </span>
              </h3>

              <div className="space-y-2">
                {bucket.map((idea) => (
                  <PublicIdeaCard key={idea.id} idea={idea} meta={meta} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function PublicIdeaCard({ idea, meta }: { idea: PublicIdea; meta: StatusMeta }) {
  return (
    <div
      className="rounded-md border p-3"
      style={{
        borderColor: "var(--color-border-default)",
        backgroundColor: meta.bg,
      }}
    >
      <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
        {idea.body}
      </div>
      {idea.response && (
        <div
          className="mt-3 pt-3 border-t hairline text-[12.5px] leading-relaxed"
        >
          <div
            className="text-[10.5px] uppercase tracking-wide font-semibold mb-1"
            style={{ color: meta.fg }}
          >
            Our response
          </div>
          <div style={{ color: "var(--color-ink)" }} className="whitespace-pre-wrap">
            {idea.response}
          </div>
        </div>
      )}
      <div className="mt-2 text-[10.5px] muted-text tabular-nums">
        {idea.submitted_at?.slice(0, 10)}
      </div>
    </div>
  );
}
