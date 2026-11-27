import { NextRequest, NextResponse } from "next/server";
import zlib from "node:zlib";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export type MediaKind = "audio" | "video" | "youtube" | "webcast";

const DIRECT_AUDIO_RE = /\.(mp3|m4a|wav|ogg|aac|flac)(\?[^\s"'<>)]*)?$/i;
const DIRECT_VIDEO_RE = /\.(mp4|webm|m3u8)(\?[^\s"'<>)]*)?$/i;
const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

const IGNORE_HOST_RE =
  /(?:^|\.)(bseindia\.com|nseindia\.com|sebi\.gov\.in|mca\.gov\.in|india\.gov\.in|adobe\.com|w3\.org)$/i;

let schemaChecked = false;
async function ensureCacheTable() {
  if (schemaChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS app.concall_audio_cache (
      announcement_id TEXT PRIMARY KEY,
      symbol          TEXT NOT NULL,
      media_url       TEXT NOT NULL,
      media_kind      TEXT NOT NULL,
      source_pdf_url  TEXT,
      resolved_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.catch(() => {});
  schemaChecked = true;
}

function classifyMedia(url: string): { kind: MediaKind; youtubeEmbedUrl: string | null } {
  const clean = url.trim();
  const yt = clean.match(YOUTUBE_RE);
  if (yt) {
    return {
      kind: "youtube",
      youtubeEmbedUrl: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`,
    };
  }
  const pathPart = clean.split("#")[0];
  if (DIRECT_AUDIO_RE.test(pathPart)) return { kind: "audio", youtubeEmbedUrl: null };
  if (DIRECT_VIDEO_RE.test(pathPart)) return { kind: "video", youtubeEmbedUrl: null };
  return { kind: "webcast", youtubeEmbedUrl: null };
}

function unwrapRedirectUrl(rawUrl: string): string {
  let u = rawUrl
    .replace(/\\\r?\n/g, "")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/[.,;>]+$/, "")
    .trim();

  try {
    const parsed = new URL(u);
    if (
      parsed.hostname.includes("safelinks.protection.outlook.com") ||
      parsed.hostname.includes("urldefense") ||
      (parsed.hostname.includes("google.") && parsed.pathname === "/url")
    ) {
      const inner = parsed.searchParams.get("url") || parsed.searchParams.get("q");
      if (inner && /^https?:\/\//i.test(inner)) {
        u = inner.trim();
      }
    }
  } catch {
    // ignore invalid URLs
  }
  return u;
}

function scoreCandidateUrl(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return -1;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return -1;
  const host = parsed.hostname.toLowerCase();
  if (IGNORE_HOST_RE.test(host)) return -1;
  if (/\.pdf(\?|$)/i.test(parsed.pathname)) return -1;

  const full = url.toLowerCase();
  const { kind } = classifyMedia(url);
  if (kind === "audio") return 100;
  if (kind === "video") return 96;
  if (kind === "youtube") return 92;

  // Bare corporate homepage (e.g. http://www.tcs.com/ in footer letterhead) is low-value
  const pathAndHash = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/+$/, "");
  if (!pathAndHash) return 5;

  let score = 40;
  if (/(audio|recording|concall|earnings|conference|analyst|webcast|media|mp3|video)/i.test(full)) {
    score += 35;
  }
  if (/(investor|financial|results|quarter|presentation|disclosure)/i.test(full)) {
    score += 15;
  }
  return score;
}

function extractUrlsFromPdfBuffer(buf: Buffer): string[] {
  const candidates = new Set<string>();
  const blobs: Buffer[] = [buf];

  // Decompress FlateDecode PDF streams to inspect PDF 1.5+ /URI link annotations & text streams
  const rawLatin = buf.toString("latin1");
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(rawLatin)) !== null) {
    const chunk = Buffer.from(m[1], "latin1");
    try {
      blobs.push(zlib.inflateSync(chunk));
      continue;
    } catch {
      // try raw deflate
    }
    try {
      blobs.push(zlib.inflateRawSync(chunk));
    } catch {
      // non-deflate stream (e.g. image/font), skip
    }
  }

  for (const b of blobs) {
    const s = b.toString("latin1");

    // 1. Exact PDF hyperlink annotations: /URI (https://...)
    const uriRe = /\/URI\s*\(([^)]+(?:\\\([^)]*\\\)[^)]*)*)\)/g;
    let um: RegExpExecArray | null;
    while ((um = uriRe.exec(s)) !== null) {
      const cleaned = unwrapRedirectUrl(um[1]);
      if (/^https?:\/\//i.test(cleaned)) candidates.add(cleaned);
    }

    // 2. Plain URLs inside text streams or uncompressed bodies
    const plainRe = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'*+,;=%-]+/g;
    let pm: RegExpExecArray | null;
    while ((pm = plainRe.exec(s)) !== null) {
      const cleaned = unwrapRedirectUrl(pm[0]);
      if (/^https?:\/\//i.test(cleaned)) candidates.add(cleaned);
    }
  }

  return [...candidates];
}

function bseCandidatePdfUrls(pdfUrl: string): string[] {
  const pnameMatch = pdfUrl.match(/Pname=([^&]+\.pdf)/i) || pdfUrl.match(/\/([^/]+\.pdf)$/i);
  if (!pnameMatch) return [pdfUrl];
  const pname = pnameMatch[1];
  return [
    `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${pname}`,
    `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${pname}`,
    pdfUrl,
  ];
}

async function sniffDirectMediaFromWebpage(pageUrl: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (/^audio\//i.test(ct) || /^video\//i.test(ct)) return pageUrl;
    if (!ct.includes("html")) return null;

    const html = (await res.text()).slice(0, 350_000);

    // Check direct absolute or root-relative .mp3/.m4a/.mp4 or YouTube embed links
    const absMediaRe =
      /https?:\/\/[^\s"'<>\\]+?\.(?:mp3|m4a|wav|mp4)(\?[^\s"'<>\\]*)?/gi;
    const absMatches = html.match(absMediaRe);
    if (absMatches && absMatches.length > 0) {
      return absMatches[0];
    }

    const relMediaRe =
      /(?:href|src)=["'](\/[^"']+?\.(?:mp3|m4a|wav|mp4)(?:\?[^"']*)?)["']/gi;
    const relMatch = relMediaRe.exec(html);
    if (relMatch) {
      return new URL(relMatch[1], pageUrl).toString();
    }

    const ytMatch = html.match(
      /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|live\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/i,
    );
    if (ytMatch) return ytMatch[0];
  } catch {
    // Webpage blocked or timed out; caller will fall back to pageUrl itself
  }
  return null;
}

export async function GET(req: NextRequest) {
  const annId = req.nextUrl.searchParams.get("id")?.trim() || "";
  if (!annId) {
    return NextResponse.json({ ok: false, error: "Missing announcement id" }, { status: 400 });
  }

  await ensureCacheTable();

  // 1. Check persistent cache first
  const cached = await sql<
    { symbol: string; media_url: string; media_kind: MediaKind; source_pdf_url: string | null }[]
  >`
    SELECT symbol, media_url, media_kind, source_pdf_url
      FROM app.concall_audio_cache
     WHERE announcement_id = ${annId}
     LIMIT 1
  `.catch(() => []);

  if (cached.length > 0) {
    const c = cached[0];
    const { youtubeEmbedUrl } = classifyMedia(c.media_url);
    return NextResponse.json({
      ok: true,
      cached: true,
      symbol: c.symbol,
      mediaUrl: c.media_url,
      mediaKind: c.media_kind,
      youtubeEmbedUrl,
      sourcePdfUrl: c.source_pdf_url,
    });
  }

  // 2. Load announcement metadata
  const rows = await sql<
    { id: string; symbol: string; headline: string | null; title: string; pdf_url: string | null }[]
  >`
    SELECT id, symbol, headline, title, pdf_url
      FROM app.announcement
     WHERE id = ${annId}
     LIMIT 1
  `.catch(() => []);

  if (rows.length === 0 || !rows[0].pdf_url) {
    return NextResponse.json({ ok: false, error: "Audio filing not found" }, { status: 404 });
  }

  const ann = rows[0];
  const sourcePdfUrl = ann.pdf_url!;
  const allCandidates: string[] = [];

  // Check if headline itself already embeds a direct URL
  const textBlob = `${ann.headline ?? ""} ${ann.title}`;
  const headlineUrls = textBlob.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
  for (const hu of headlineUrls) allCandidates.push(unwrapRedirectUrl(hu));

  // Fetch BSE cover-letter PDF and extract embedded /URI annotations + stream URLs
  for (const candidatePdf of bseCandidatePdfUrls(sourcePdfUrl)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(candidatePdf, {
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
          Referer: "https://www.bseindia.com/",
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      if (buf.length > 500 && buf.subarray(0, 4).toString("latin1") === "%PDF") {
        const extracted = extractUrlsFromPdfBuffer(buf);
        allCandidates.push(...extracted);
        break;
      }
    } catch {
      // try next BSE mirror folder
    }
  }

  // Rank extracted URLs
  const scored = allCandidates
    .map((url) => ({ url, score: scoreCandidateUrl(url) }))
    .filter((x) => x.score > 10)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Could not locate an external audio link inside this filing.",
        sourcePdfUrl: ann.pdf_url,
      },
      { status: 404 },
    );
  }

  let bestUrl = scored[0].url;
  let { kind, youtubeEmbedUrl } = classifyMedia(bestUrl);

  // 3. If the best link in the PDF is an IR webpage, sniff that page for a direct .mp3/.mp4/YouTube stream
  if (kind === "webcast") {
    const directStream = await sniffDirectMediaFromWebpage(bestUrl);
    if (directStream) {
      bestUrl = directStream;
      const upgraded = classifyMedia(bestUrl);
      kind = upgraded.kind;
      youtubeEmbedUrl = upgraded.youtubeEmbedUrl;
    }
  }

  // Persist to cache for instant future playback
  await sql`
    INSERT INTO app.concall_audio_cache (announcement_id, symbol, media_url, media_kind, source_pdf_url)
    VALUES (${ann.id}, ${ann.symbol}, ${bestUrl}, ${kind}, ${ann.pdf_url})
    ON CONFLICT (announcement_id) DO UPDATE
      SET media_url = EXCLUDED.media_url,
          media_kind = EXCLUDED.media_kind,
          resolved_at = now()
  `.catch(() => {});

  return NextResponse.json({
    ok: true,
    cached: false,
    symbol: ann.symbol,
    mediaUrl: bestUrl,
    mediaKind: kind,
    youtubeEmbedUrl,
    sourcePdfUrl: ann.pdf_url,
  });
}
