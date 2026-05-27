/**
 * /admin/ideas — view recent /feedback submissions.
 *
 * Auth flow:
 *   - First visit: append ?token=<ADMIN_TOKEN> to the URL.
 *     The page detects the token, redirects to /api/admin/auth?token=...
 *     which validates + sets a cookie + redirects back here.
 *   - Subsequent visits: the cookie carries the auth, no token needed.
 *
 * Why not set the cookie here directly: Next.js 15 server components can
 * READ cookies but cannot SET them. Setting must happen in a Route
 * Handler (the auth route) or a Server Action.
 *
 * Cost (Rule #1): one SELECT per page view (only you see this page).
 */
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdminRequest } from "@/lib/auth";
import { TriageActions } from "./TriageActions";

export const dynamic = "force-dynamic";

type Idea = {
  id: number;
  submitted_at: string;
  name: string | null;
  email: string | null;
  body: string;
  page_url: string | null;
  user_agent: string | null;
  handled: boolean;
  notes: string | null;
  status: string;
  is_public: boolean;
  response: string | null;
};

/** Admin gate. Either the er_admin cookie OR a signed-in user whose
 *  email is listed in ADMIN_EMAILS is accepted — see lib/auth.ts. */
async function isAuthed(): Promise<boolean> {
  return isAdminRequest();
}

export default async function AdminIdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;

  // If the user landed here with ?token=..., bounce to the auth route
  // which sets the cookie and redirects back. Page components can't set
  // cookies in Next.js 15.
  if (sp.token) {
    redirect(`/api/admin/auth?token=${encodeURIComponent(sp.token)}&redirect=/admin/ideas`);
  }

  if (!(await isAuthed())) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-[18px] font-display mb-2">Admin only</h1>
        <p className="muted-text text-[13px]">
          Append <code>?token=YOUR_TOKEN</code> to the URL.
        </p>
      </div>
    );
  }

  const ideas = await sql<Idea[]>`
    SELECT id, submitted_at::text, name, email, body, page_url, user_agent,
           handled, notes, status, is_public, response
    FROM app.user_ideas
    ORDER BY handled ASC, submitted_at DESC
    LIMIT 200
  `;

  const unhandled = ideas.filter((i) => !i.handled).length;

  return (
    <div className="mx-auto max-w-[900px] px-4 md:px-6 py-6 md:py-8">
      <header className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[26px] tracking-tight">User ideas</h1>
          <p className="muted-text text-[12.5px] mt-1">
            {ideas.length} total · {unhandled} unhandled
          </p>
        </div>
      </header>

      {ideas.length === 0 ? (
        <div className="card p-10 text-center muted-text text-[13.5px]">
          No submissions yet. Share /feedback with users and check back.
        </div>
      ) : (
        <ul className="space-y-3">
          {ideas.map((idea) => (
            <li key={idea.id} className="card p-4">
              <header className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12px] tabular-nums muted-text">
                    #{idea.id}
                  </span>
                  <span className="text-[12px] tabular-nums muted-text">
                    {idea.submitted_at?.slice(0, 19).replace("T", " ")}
                  </span>
                  {idea.handled && (
                    <span
                      className="text-[10.5px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: "var(--color-paper)",
                        color: "var(--color-muted)",
                      }}
                    >
                      handled
                    </span>
                  )}
                </div>
                <div className="text-[12px] muted-text">
                  {idea.name && <span>{idea.name}</span>}
                  {idea.name && idea.email && <span> · </span>}
                  {idea.email && (
                    <a href={`mailto:${idea.email}`} className="hover:underline">
                      {idea.email}
                    </a>
                  )}
                </div>
              </header>
              <div className="text-[14px] leading-relaxed whitespace-pre-wrap">
                {idea.body}
              </div>
              {(idea.page_url || idea.user_agent) && (
                <div className="mt-2 text-[10.5px] muted-text font-mono break-all">
                  {idea.page_url && <div>from: {idea.page_url}</div>}
                  {idea.user_agent && (
                    <div className="truncate">ua: {idea.user_agent}</div>
                  )}
                </div>
              )}
              {idea.notes && (
                <div
                  className="mt-2 px-2 py-1 rounded text-[12px] italic"
                  style={{
                    backgroundColor: "var(--color-paper)",
                    color: "var(--color-muted)",
                  }}
                >
                  notes: {idea.notes}
                </div>
              )}
              <TriageActions
                id={idea.id}
                handled={idea.handled}
                notes={idea.notes}
                status={idea.status}
                isPublic={idea.is_public}
                response={idea.response}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
