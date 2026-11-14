/**
 * /feedback — public submission form + public board.
 *
 * Form: anyone can submit. POSTs to /api/feedback → INSERTs into
 * app.user_ideas. State stays private unless I (admin) explicitly flag
 * the row as public from /admin/ideas.
 *
 * Public board: rows where is_public = true, grouped by status. Shows
 * only body + status + admin response — never name/email/page/UA/IP.
 *
 * Revalidate every 5 minutes — board updates appear quickly after I
 * flip a publish toggle, but visiting the page doesn't hit Neon on
 * every load.
 */
import { sql } from "@/lib/db";
import { FeedbackForm } from "./FeedbackForm";
import { PublicBoard, type PublicIdea } from "./PublicBoard";

// 5-minute ISR: long enough that repeated visits are served from cache,
// short enough that toggling publish on /admin/ideas shows up quickly.
export const revalidate = 300;

export const metadata = {
  title: "Feedback & Roadmap — EquityRoots",
  description:
    "Tell us what to build next. See what others have suggested, what we're working on, and what's shipped.",
};

async function loadPublic(): Promise<PublicIdea[]> {
  // Public board excludes name/email/page_url/user_agent/ip_hash by
  // construction — those columns are never selected here, so a
  // privacy bug at this layer is impossible.
  return sql<PublicIdea[]>`
    SELECT id, submitted_at::text, body, status, response
    FROM app.user_ideas
    WHERE is_public = true
    ORDER BY
      CASE status
        WHEN 'shipped'  THEN 1
        WHEN 'building' THEN 2
        WHEN 'planned'  THEN 3
        WHEN 'open'     THEN 4
        WHEN 'wont_do'  THEN 5
        ELSE 6
      END,
      submitted_at DESC
    LIMIT 100
  `;
}

export default async function FeedbackPage() {
  const publicIdeas = await loadPublic();

  return (
    <div className="mx-auto max-w-[720px] px-4 md:px-6 py-4 md:py-6">
      <header className="pb-2.5 mb-4 border-b hairline">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] muted-text mb-0.5">
          Feedback & roadmap
        </div>
        <h1 className="font-display text-[18px] md:text-[20px] font-semibold leading-tight tracking-tight">
          What should we build next?
        </h1>
        <p className="muted-text text-[12px] mt-0.5">
          Found a bug or want a feature? Submissions are private by default.
        </p>
      </header>

      <FeedbackForm />

      {publicIdeas.length > 0 && (
        <PublicBoard ideas={publicIdeas} />
      )}
    </div>
  );
}
