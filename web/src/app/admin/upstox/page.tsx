/**
 * /admin/upstox — single-page Upstox session status + reauth button.
 *
 * Designed for one specific UX: the admin (you) bookmarks this page on
 * a phone home screen, opens it once a day around 08:00 IST, taps
 * "Reauth via Upstox", completes the Upstox login in the browser, and
 * is done in under 30 seconds. No laptop dependency.
 *
 * Auth model matches /admin/ideas:
 *   - First visit: open the bookmark, which carries `?token=<ADMIN_TOKEN>`.
 *     We redirect to /api/admin/auth which validates + sets the er_admin
 *     cookie + redirects back here clean.
 *   - Subsequent visits: cookie is enough, no token needed.
 *
 * Page shows token state (valid / expired / missing) at-a-glance so you
 * don't have to remember whether you already reauthed today.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
const COOKIE_NAME = "er_admin";

type SessionRow = {
  access_token: string | null;
  upstox_user_id: string | null;
  upstox_user_name: string | null;
  expires_at: string | null;
  refreshed_at: string | null;
};

async function isAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const expectedHash = createHash("sha256").update(expected).digest("hex");
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === expectedHash;
}

async function loadSession(): Promise<SessionRow> {
  const rows = await sql<SessionRow[]>`
    SELECT access_token,
           upstox_user_id,
           upstox_user_name,
           expires_at::text   AS expires_at,
           refreshed_at::text AS refreshed_at
      FROM app.upstox_session
     WHERE id = 1
  `;
  return rows[0] ?? {
    access_token: null, upstox_user_id: null, upstox_user_name: null,
    expires_at: null, refreshed_at: null,
  };
}

export default async function UpstoxAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/upstox`);
  }
  if (!(await isAuthed())) {
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
  const status = sessionStatus(session);
  const fmt = (iso: string | null): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-IN", {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <Mobile>
      <h1 className="font-display text-[22px] leading-tight mb-1">Upstox session</h1>
      <p className="muted-text text-[12px] mb-5">
        Daily 1-tap reauth for the intraday LTP refresh.
      </p>

      <StatusBadge status={status} />

      <dl className="mt-5 space-y-3 text-[13px]">
        <Row label="User">
          {session.upstox_user_name || session.upstox_user_id || "—"}
        </Row>
        <Row label="Last reauth">{fmt(session.refreshed_at)}</Row>
        <Row label="Token expires">{fmt(session.expires_at)}</Row>
      </dl>

      <a
        href="/api/upstox/login"
        className="mt-7 inline-flex items-center justify-center w-full px-5 py-3 rounded-md font-medium text-[15px] transition-colors"
        style={{ backgroundColor: "var(--color-accent-600)", color: "white" }}
      >
        {status === "valid" ? "Reauth via Upstox" : "Sign in to Upstox"}
      </a>

      <p className="muted-text text-[11px] mt-5 leading-snug">
        Reauth opens Upstox&apos;s login. After you authorise, you&apos;ll be
        redirected back here. The GH Action picks up the new token on
        the next 30-min run automatically.
      </p>
    </Mobile>
  );
}

type Status = "valid" | "expired" | "missing";

function sessionStatus(s: SessionRow): Status {
  if (!s.access_token) return "missing";
  if (!s.expires_at) return "valid";
  return new Date(s.expires_at) > new Date() ? "valid" : "expired";
}

function StatusBadge({ status }: { status: Status }) {
  const map = {
    valid:   { label: "Active",  bg: "#1f8a4c", fg: "white" },
    expired: { label: "Expired", bg: "#c97a3f", fg: "white" },
    missing: { label: "Not signed in", bg: "var(--color-muted)", fg: "white" },
  } as const;
  const c = map[status];
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11.5px] font-semibold tracking-wide uppercase"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ backgroundColor: "white", opacity: 0.85 }}
      />
      {c.label}
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

/** Phone-friendly wrapper — narrow column, generous padding, no clutter. */
function Mobile({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[440px] px-4 py-8">
      <div className="card p-6">{children}</div>
    </div>
  );
}
