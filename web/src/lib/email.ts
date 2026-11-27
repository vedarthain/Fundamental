import "server-only";

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

/**
 * Send transactional/alert email via Resend HTTP API.
 * Uses RESEND_API_KEY and ALERT_FROM_EMAIL (e.g. "EquityRoots <alerts@equityroots.in>").
 * Note: Resend's default onboarding@resend.dev sender only delivers to the Resend
 * account owner's email until your sending domain (equityroots.in) is verified.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const from =
    process.env.ALERT_FROM_EMAIL?.trim() ||
    "EquityRoots Alerts <onboarding@resend.dev>";
  const toList = Array.isArray(input.to) ? input.to : [input.to];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "EquityRoots-Alerts/1.0",
      },
      body: JSON.stringify({
        from,
        to: toList,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        error: data.message || `Resend HTTP ${res.status}`,
      };
    }

    return { ok: true, id: data.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
