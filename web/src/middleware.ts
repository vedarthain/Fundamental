import { NextRequest, NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastPrune = Date.now();

const WINDOW_MS = 60_000;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function isLocalhost(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function getLimitForPath(pathname: string): { tier: string; max: number } | null {
  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/signup") ||
    pathname.startsWith("/api/auth/change-password") ||
    pathname.startsWith("/api/admin/auth")
  ) {
    return { tier: "auth", max: 12 };
  }

  if (
    pathname.startsWith("/api/scanner/") ||
    pathname.startsWith("/api/stock/") ||
    pathname.startsWith("/api/opportunities") ||
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/calls") ||
    pathname.startsWith("/api/indices") ||
    pathname.startsWith("/api/market-indices")
  ) {
    return { tier: "data", max: 90 };
  }

  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const policy = getLimitForPath(pathname);
  if (!policy) return NextResponse.next();

  const ip = getClientIp(req);
  if (isLocalhost(ip)) return NextResponse.next();

  const now = Date.now();
  if (now - lastPrune > WINDOW_MS) {
    for (const [k, b] of buckets.entries()) {
      if (now >= b.resetAt) buckets.delete(k);
    }
    lastPrune = now;
  }

  const key = `${policy.tier}:${ip}`;
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const remaining = Math.max(0, policy.max - bucket.count);

  if (bucket.count > policy.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(policy.max),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(policy.max));
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
