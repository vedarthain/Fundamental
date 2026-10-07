/**
 * Admin-only verdict API — the data behind the watchlist chips, the verdict
 * sheet and the Verdict tab.
 *
 *   GET ?symbol=TITAN   → full VerdictData for one symbol (null if none)
 *   GET ?chips=A,B,C    → VerdictChip[] for many symbols, for the row markers
 *   GET ?queue=1        → VerdictQueue: work queue + weekly timeline
 *
 * It lives under /api/admin rather than /api/watchlist deliberately. The
 * watchlist route is called by every signed-in user and returns a large row
 * payload; folding a private hand-written opinion into it would make the
 * gating a property of one `if` inside a 800-line handler that also has a
 * `lean=1` fast path. A separate route means the only way to receive a verdict
 * is to ask this URL, and the only way to pass it is isAdminRequest(). A
 * non-admin gets 401 and no shape to infer from.
 *
 * Every response is uncached. These are opinions read against live metrics by
 * the one person who writes them; a cached verdict that has silently drifted
 * is the exact failure the drift table exists to prevent.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { loadVerdict, loadVerdictChips, loadVerdictQueue } from "@/lib/verdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guard on the chips list. The watchlist is ~250 symbols; anything far past
 *  that is a malformed or hostile query rather than a real list. */
const MAX_CHIP_SYMBOLS = 600;

export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "admin only" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;

  if (q.get("queue")) {
    const weeksRaw = Number(q.get("weeks"));
    const weeks = Number.isFinite(weeksRaw) && weeksRaw >= 4 && weeksRaw <= 52
      ? Math.floor(weeksRaw)
      : 12;
    return NextResponse.json(await loadVerdictQueue(weeks), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const chips = q.get("chips");
  if (chips) {
    const symbols = [
      ...new Set(
        chips.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      ),
    ].slice(0, MAX_CHIP_SYMBOLS);
    const map = await loadVerdictChips(symbols);
    return NextResponse.json(
      { chips: [...map.values()] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const symbol = q.get("symbol");
  if (symbol) {
    const data = await loadVerdict(symbol);
    // 200 with `null` rather than 404: "nobody has written one" is a real
    // answer and the sheet renders an explicit empty state for it. A 404 would
    // be indistinguishable from a broken route.
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { error: "pass ?symbol=, ?chips= or ?queue=1" },
    { status: 400 },
  );
}
