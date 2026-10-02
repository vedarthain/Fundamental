/**
 * /admin/screener — Screener session status + one-tap rotation.
 *
 * Deliberately a near-copy of /admin/upstox, including the auth model and the
 * phone-first layout, because that page already works and the operator should
 * not have to learn a second shape. Differences are forced by Screener having no
 * OAuth: there is no redirect dance, so the credentials come from a form and the
 * login happens server-side in /api/screener/session.
 *
 * Auth model, same as /admin/upstox and /admin/ideas:
 *   - First visit: open the bookmark carrying `?token=<ADMIN_TOKEN>`, which
 *     redirects through /api/admin/auth to set the er_admin cookie.
 *   - Later visits: the cookie is enough.
 *
 * WHY THE PAGE SHOWS verified_at RATHER THAN "ACTIVE"
 *
 * It would be easy to render a green "Active" badge from the presence of a
 * sessionid. That is the lie this whole change exists to stop — on 2026-10-02 a
 * freshness check printed a green tick for a cookie that had been dead for
 * weeks, because it inspected something that did not require authentication.
 * This page claims only what it knows: when the cookie was last PROVEN against
 * the login-gated Key Points fragment, and how long ago that was. Staleness is
 * shown as an age, not graded into a verdict, because the morning cookie_health
 * probe in scripts/check-freshness.py is the thing that actually re-tests it and
 * a second, weaker opinion here would just be noise.
 */
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";
import SessionForm from "./SessionForm";

export const dynamic = "force-dynamic";

type SessionRow = {
  has_cookie: boolean;
  verified_at: string | null;
  verified_symbol: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

async function loadSession(): Promise<SessionRow | null> {
  // Returns null — not a blank row — when the table is missing, so the page can
  // say "migration not applied" instead of implying an empty session.
  try {
    const rows = await sql<SessionRow[]>`
      SELECT (sessionid IS NOT NULL AND sessionid <> '') AS has_cookie,
             verified_at::text AS verified_at,
             verified_symbol,
             updated_at::text  AS updated_at,
             updated_by
        FROM app.screener_session
       WHERE id = 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export default async function ScreenerAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/screener`);
  }
  if (!(await isAdminRequest())) {
    return (
      <Mobile>
        <h1 className="font-display text-[20px] mb-2">Admin only</h1>
        <p className="muted-text text-[13px]">
          Append <code>?token=YOUR_ADMIN_TOKEN</code> to the URL on the first visit.
        </p>
      </Mobile>
    );
  }

  const session = await loadSession();

  return (
    <Mobile>
      <h1 className="font-display text-[22px] leading-tight mb-1">Screener session</h1>
      <p className="muted-text text-[12px] mb-5">
        One copy of the cookie, read by every Screener job.
      </p>

      {session === null ? (
        <p className="text-[13px]" style={{ color: "#9c2a2a" }}>
          <code>app.screener_session</code> is not readable — migration 0084 has probably not
          been applied to this database.
        </p>
      ) : (
        <>
          <Badge
            label={session.has_cookie ? "Cookie stored" : "No cookie stored"}
            bg={session.has_cookie ? "#1f8a4c" : "var(--color-muted)"}
          />
          <dl className="mt-5 space-y-3 text-[13px]">
            <Row label="Last proven">{ageOf(session.verified_at)}</Row>
            <Row label="Proven against">{session.verified_symbol || "—"}</Row>
            <Row label="Last rotated">{fmt(session.updated_at)}</Row>
            <Row label="Rotated by">{session.updated_by || "—"}</Row>
          </dl>
        </>
      )}

      <SessionForm />

      <p className="muted-text text-[11px] mt-5 leading-snug">
        Rotating writes <code>app.screener_session</code>. There is no GitHub secret to update
        any more — the overview, company-info, shareholding and weekly-fetch workflows all read
        this row, and <code>SCREENER_SESSIONID</code> survives only as a local override.
      </p>
    </Mobile>
  );
}

/** Age, not a verdict — see the file header for why this page grades nothing. */
function ageOf(iso: string | null): string {
  if (!iso) return "never proven";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  const when = fmt(iso);
  if (days <= 0) return `${when} (today)`;
  return `${when} (${days}d ago)`;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Badge({ label, bg }: { label: string; bg: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11.5px] font-semibold tracking-wide uppercase"
      style={{ backgroundColor: bg, color: "white" }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: "white", opacity: 0.85 }}
      />
      {label}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="muted-text text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** Phone-friendly wrapper — matches /admin/upstox exactly. */
function Mobile({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[440px] px-4 py-8">
      <div className="card p-6">{children}</div>
    </div>
  );
}
