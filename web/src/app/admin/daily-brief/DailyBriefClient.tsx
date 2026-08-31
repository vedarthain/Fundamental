"use client";

/**
 * Admin Morning Brief console: upload an epaper PDF, generate the brief, and
 * review / delete past briefs. The PDF is sent to /api/admin/daily-brief and
 * processed server-side (extract → filter → Claude → store); it is never kept.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type BriefItem = { title: string; summary: string; symbols: string[] };
type BriefSection = { heading: string; items: BriefItem[] };
type StoredBrief = {
  id: string;
  paper: string;
  paperLabel: string;
  briefDate: string;
  generatedAt: string;
  model: string | null;
  sourcePages: number | null;
  sections: BriefSection[];
  symbols: string[];
};
type BriefListRow = {
  id: string;
  paper: string;
  paperLabel: string;
  briefDate: string;
  generatedAt: string;
  itemCount: number;
};

const PAPERS: Record<string, string> = {
  "financial-express": "Financial Express",
  "business-standard": "Business Standard",
};

const card: React.CSSProperties = {
  border: "1px solid var(--color-border, #e2e5ec)",
  borderRadius: 12,
  padding: "1.25rem",
  marginBottom: "1.25rem",
};

export default function DailyBriefClient() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [paper, setPaper] = useState("financial-express");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [brief, setBrief] = useState<StoredBrief | null>(null);
  const [list, setList] = useState<BriefListRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refreshList() {
    try {
      const r = await fetch("/api/admin/daily-brief");
      if (r.ok) {
        const d = await r.json();
        setList(d.briefs ?? []);
      }
    } catch {
      /* non-fatal */
    }
  }
  useEffect(() => {
    // Inline async load on mount — setState happens only after the await, so
    // this doesn't trigger the synchronous set-state-in-effect lint.
    (async () => {
      try {
        const r = await fetch("/api/admin/daily-brief");
        if (r.ok) {
          const d = await r.json();
          setList(d.briefs ?? []);
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg({ kind: "err", text: "Pick an epaper PDF first." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("paper", paper);
      fd.append("date", date);
      fd.append("file", file);
      const r = await fetch("/api/admin/daily-brief", { method: "POST", body: fd });
      // Read as text first: platform-level failures (413 body-too-large, 504
      // timeout) return an HTML error page, not JSON. Parsing that blindly threw
      // an opaque "unexpected character" error and hid the real status.
      const raw = await r.text();
      let d: { ok?: boolean; brief?: StoredBrief; error?: string; detail?: string } | null = null;
      try {
        d = raw ? JSON.parse(raw) : null;
      } catch {
        /* non-JSON — fall through to status-based messaging below */
      }
      if (!r.ok || !d?.ok || !d.brief) {
        const msg =
          d?.detail ||
          d?.error ||
          (r.status === 413
            ? "PDF exceeds the ~4.5 MB serverless upload limit. Compress or split the epaper (see note below)."
            : r.status === 504
              ? "Timed out generating the brief (120s). Try a smaller / fewer-page PDF."
              : `Server error (HTTP ${r.status}).${raw ? ` ${raw.slice(0, 120)}` : ""}`);
        throw new Error(msg);
      }
      setBrief(d.brief);
      setMsg({
        kind: "ok",
        text: `Brief generated from ${d.brief.sourcePages ?? "?"} news page(s).`,
      });
      if (fileRef.current) fileRef.current.value = "";
      refreshList();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function openBrief(row: BriefListRow) {
    setMsg(null);
    try {
      const r = await fetch(
        `/api/admin/daily-brief?paper=${encodeURIComponent(row.paper)}&date=${row.briefDate}`,
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "could not load");
      setBrief(d.brief);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function removeBrief(id: string) {
    if (!confirm("Delete this brief?")) return;
    try {
      const r = await fetch(`/api/admin/daily-brief?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      if (brief?.id === id) setBrief(null);
      refreshList();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div>
      {/* Upload */}
      <section style={card}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Generate a brief
        </h2>
        <form onSubmit={onGenerate} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            Paper
            <select value={paper} onChange={(e) => setPaper(e.target.value)} style={inputStyle}>
              {Object.entries(PAPERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            Edition date
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem", gap: 4 }}>
            Epaper PDF
            <input ref={fileRef} type="file" accept="application/pdf" style={{ fontSize: "0.85rem" }} />
          </label>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: busy ? "#94a3b8" : "#1E2761",
              color: "#fff",
              padding: "0.55rem 1.1rem",
              borderRadius: 8,
              fontWeight: 600,
              border: "none",
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "Generating…" : "Generate brief"}
          </button>
        </form>
        <p style={{ color: "var(--color-muted)", fontSize: "0.8rem", marginTop: "0.75rem" }}>
          The PDF is processed in memory and discarded — only the synthesized brief is stored.
          Private to admin.
        </p>
        {msg && (
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.85rem",
              color: msg.kind === "ok" ? "#15803d" : "#b91c1c",
            }}
          >
            {msg.text}
          </p>
        )}
      </section>

      {/* Viewer */}
      {brief && <BriefView brief={brief} />}

      {/* History */}
      <section style={card}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.75rem" }}>Past briefs</h2>
        {list.length === 0 ? (
          <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>No briefs yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-muted)" }}>
                <th style={th}>Date</th>
                <th style={th}>Paper</th>
                <th style={th}>Items</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--color-border, #e2e5ec)" }}>
                  <td style={td}>{row.briefDate}</td>
                  <td style={td}>{row.paperLabel}</td>
                  <td style={td}>{row.itemCount}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button onClick={() => openBrief(row)} style={linkBtn}>
                      View
                    </button>
                    <button onClick={() => removeBrief(row.id)} style={{ ...linkBtn, color: "#b91c1c" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function BriefView({ brief }: { brief: StoredBrief }) {
  return (
    <section style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>
          {brief.paperLabel} — {brief.briefDate}
        </h2>
        <span style={{ color: "var(--color-muted)", fontSize: "0.75rem" }}>
          {brief.sourcePages ?? "?"} pages · {brief.model ?? "—"}
        </span>
      </div>
      {brief.sections.length === 0 ? (
        <p style={{ color: "var(--color-muted)", fontSize: "0.85rem" }}>No items.</p>
      ) : (
        brief.sections.map((sec, si) => (
          <div key={si} style={{ marginBottom: "1rem" }}>
            <h3
              style={{
                fontSize: "0.8rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#1E2761",
                marginBottom: "0.5rem",
              }}
            >
              {sec.heading}
            </h3>
            {sec.items.map((it, ii) => (
              <div key={ii} style={{ marginBottom: "0.65rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{it.title}</div>
                <div style={{ fontSize: "0.88rem", color: "var(--color-ink, #1f2937)" }}>{it.summary}</div>
                {it.symbols.length > 0 && (
                  <div style={{ marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {it.symbols.map((s) => (
                      <a
                        key={s}
                        href={`/stock/${s}`}
                        style={{
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          background: "#eef2ff",
                          color: "#1E2761",
                          padding: "1px 7px",
                          borderRadius: 999,
                          textDecoration: "none",
                        }}
                      >
                        {s}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.45rem 0.6rem",
  borderRadius: 8,
  border: "1px solid var(--color-border, #cbd5e1)",
  fontSize: "0.85rem",
};
const th: React.CSSProperties = { padding: "0.4rem 0.5rem", fontWeight: 600 };
const td: React.CSSProperties = { padding: "0.45rem 0.5rem" };
const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#1E2761",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.82rem",
  marginLeft: 10,
  padding: 0,
};
