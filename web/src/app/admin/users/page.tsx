/**
 * /admin/users — signup / user-count dashboard (read-only).
 *
 * Auth flow mirrors /admin/ideas: first visit append ?token=<ADMIN_TOKEN>,
 * which bounces through /api/admin/auth to set the er_admin cookie. Subsequent
 * visits use the cookie. Either the cookie OR a signed-in ADMIN_EMAILS user
 * passes the gate (see lib/auth.ts).
 *
 * All counts are IST-day based (the team reads them in IST), computed in one
 * cheap query plus a 14-day daily breakdown and a recent-users list.
 */
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Stats = {
  total: number;
  today: number;
  d7: number;
  d30: number;
  active7: number;
  with_name: number;
};
type DayRow = { day: string; signups: number };
type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  joined: string;
  last_login: string | null;
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/users`);
  }
  if (!(await isAdminRequest())) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-[18px] font-display mb-2">Admin only</h1>
        <p className="muted-text text-[13px]">
          Append <code>?token=YOUR_TOKEN</code> to the URL.
        </p>
      </div>
    );
  }

  // IST-day boundaries so "today" / "7d" match the calendar you read in IST.
  const [stats] = await sql<Stats[]>`
    WITH ist AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today)
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ist.today)::int            AS today,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int                               AS d7,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int                              AS d30,
      COUNT(*) FILTER (WHERE last_login_at >= now() - interval '7 days')::int                            AS active7,
      COUNT(*) FILTER (WHERE display_name IS NOT NULL AND display_name <> '')::int                       AS with_name
    FROM app.users, ist
    GROUP BY ist.today
  `;

  const daily = await sql<DayRow[]>`
    SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS day, COUNT(*)::int AS signups
    FROM app.users
    WHERE created_at >= now() - interval '14 days'
    GROUP BY 1 ORDER BY 1 DESC
  `;

  const users = await sql<UserRow[]>`
    SELECT id::text, email::text, display_name,
           created_at::text AS joined, last_login_at::text AS last_login
    FROM app.users
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const s = stats ?? { total: 0, today: 0, d7: 0, d30: 0, active7: 0, with_name: 0 };
  const maxDay = Math.max(1, ...daily.map((d) => d.signups));

  return (
    <div className="mx-auto max-w-[900px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] tracking-tight">Users</h1>
        <p className="muted-text text-[12.5px] mt-1">Signups &amp; activity · IST-day boundaries</p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <Stat label="Total" value={s.total} accent />
        <Stat label="Today" value={s.today} />
        <Stat label="Last 7d" value={s.d7} />
        <Stat label="Last 30d" value={s.d30} />
        <Stat label="Active 7d" value={s.active7} hint="logged in" />
        <Stat label="Named" value={s.with_name} hint="set a name" />
      </div>

      {/* Daily signups (last 14d) */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">Signups · last 14 days (IST)</div>
        {daily.length === 0 ? (
          <div className="card p-4 muted-text text-[13px]">No signups in the last 14 days.</div>
        ) : (
          <div className="card p-3 space-y-1.5">
            {daily.map((d) => (
              <div key={d.day} className="flex items-center gap-3 text-[12px]">
                <span className="tabular-nums muted-text w-[78px] shrink-0">{d.day}</span>
                <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: "var(--color-paper)" }}>
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${(d.signups / maxDay) * 100}%`, background: "var(--color-accent-600)" }}
                  />
                </div>
                <span className="tabular-nums font-medium w-[34px] text-right">{d.signups}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent users */}
      <section>
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
          Recent users · {users.length} shown
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="muted-text text-[10px] uppercase tracking-wide text-left border-b hairline">
                <th className="font-medium py-2 px-3">Email</th>
                <th className="font-medium py-2 px-3">Name</th>
                <th className="font-medium py-2 px-3 whitespace-nowrap">Joined (IST)</th>
                <th className="font-medium py-2 px-3 whitespace-nowrap">Last login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t hairline">
                  <td className="py-1.5 px-3">{u.email}</td>
                  <td className="py-1.5 px-3 muted-text">{u.display_name ?? "—"}</td>
                  <td className="py-1.5 px-3 tabular-nums whitespace-nowrap">{fmtIST(u.joined)}</td>
                  <td className="py-1.5 px-3 tabular-nums whitespace-nowrap muted-text">
                    {u.last_login ? fmtIST(u.last_login) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent, hint }: { label: string; value: number; accent?: boolean; hint?: string }) {
  return (
    <div
      className="rounded-md border p-3"
      style={{
        borderColor: "var(--color-border-default)",
        background: accent ? "color-mix(in srgb, var(--color-accent-600) 8%, var(--color-card))" : "var(--color-card)",
      }}
    >
      <div className="font-display tabular-nums leading-none" style={{ fontSize: 24, color: accent ? "var(--color-accent-700)" : "var(--color-ink)" }}>
        {value.toLocaleString("en-IN")}
      </div>
      <div className="text-[11px] mt-1" style={{ color: "var(--color-ink)" }}>{label}</div>
      {hint && <div className="text-[9.5px] muted-text">{hint}</div>}
    </div>
  );
}

/** ISO timestamp → "21 Jun 2026, 18:42" in IST. */
function fmtIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
