/**
 * /feedback — public submission form.
 *
 * Anyone can submit; no login required.  We capture the page they came
 * from (referer header) for context — helps interpret submissions like
 * "the buttons here are confusing" without having to guess which page.
 *
 * Cost (Rule #1): zero CU on this page itself (no DB calls).  The submit
 * action posts to /api/feedback which does one tiny INSERT.
 */
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-static";

export const metadata = {
  title: "Feedback — EquityRoots",
  description: "Tell us what to build next, what's broken, or what could be better.",
};

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-[640px] px-4 md:px-6 py-8 md:py-12">
      <header className="mb-6">
        <div className="text-[11px] uppercase tracking-wide muted-text mb-2">
          Tell us what to build
        </div>
        <h1 className="font-display text-[28px] md:text-[32px] leading-tight tracking-tight">
          What should we work on next?
        </h1>
        <p className="muted-text text-[14px] mt-3 leading-relaxed">
          Found a bug? Want a feature? Confused by something? Type it below — every
          response is read. Email is optional but lets us reply if we have questions.
        </p>
      </header>

      <FeedbackForm />

      <section className="mt-10 pt-6 border-t hairline">
        <h2 className="text-[12.5px] uppercase tracking-wide muted-text font-semibold mb-2">
          What we&apos;re thinking about
        </h2>
        <ul className="space-y-1.5 text-[13px] muted-text">
          <li>• Saved screener filters (so you can re-run your own analyses fast)</li>
          <li>• Portfolio upload — get peer-relative scores for your holdings</li>
          <li>• Daily insight page — auto-generated &quot;top movers&quot; for sharing</li>
          <li>• Score alerts via email when a stock crosses a threshold</li>
        </ul>
        <p className="muted-text text-[12px] mt-3 leading-relaxed">
          If you&apos;d use any of these, let us know — helps us prioritise.
          And if you want something we haven&apos;t mentioned, that&apos;s exactly what this form is for.
        </p>
      </section>
    </div>
  );
}
