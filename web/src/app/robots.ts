/**
 * /robots.txt — generated dynamically by Next.js (App Router convention).
 *
 * Blocks aggressive AI training crawlers that were hammering the site
 * (~8.6 GB Vercel Fast Origin Transfer in a single day on May 27-28, almost
 * certainly a single full crawl of all 2,150 stock pages × ~150 KB each).
 *
 * Allowed: standard search engines (Google, Bing, DuckDuckGo) and the
 * default fallback for everything else.  Bookmarklets / RSS readers /
 * Slack-link-previewers behave well; no need to block them.
 *
 * To add a new blocked agent: append a User-agent entry below with
 * Disallow: '/'. List sourced from common AI crawler documentation +
 * Cloudflare's published list of AI bots.
 */
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const blockedBots = [
    "GPTBot",            // OpenAI
    "ChatGPT-User",      // OpenAI on-demand fetch (when user asks ChatGPT to read a URL)
    "OAI-SearchBot",     // OpenAI search
    "ClaudeBot",         // Anthropic
    "Claude-Web",        // Anthropic older agent
    "anthropic-ai",      // Anthropic
    "CCBot",             // Common Crawl (feeds many LLM training sets)
    "PerplexityBot",     // Perplexity
    "Perplexity-User",   // Perplexity on-demand fetch
    "Google-Extended",   // Google's training-data opt-out token
    "FacebookBot",       // Meta training
    "Meta-ExternalAgent",
    "Bytespider",        // ByteDance / TikTok
    "Diffbot",           // Web extraction
    "ImagesiftBot",
    "Omgili",
    "Amazonbot",         // Amazon Alexa / training
    "Applebot-Extended", // Apple's training opt-out token
    "AwarioRssBot",
    "AwarioSmartBot",
    "DataForSeoBot",
    "MJ12bot",           // Majestic SEO crawler
    "PetalBot",          // Huawei
    "SeekportBot",
    "TurnitinBot",
    "YouBot",
  ];

  return {
    rules: [
      // Explicit deny entries — one per known bad UA so logs are
      // grep-friendly and the file is human-readable.
      ...blockedBots.map((agent) => ({
        userAgent: agent,
        disallow: "/",
      })),
      // Everything else (Googlebot, Bingbot, casual visitors) — allow.
      {
        userAgent: "*",
        allow: "/",
        // Don't crawl admin / api endpoints regardless of UA.
        disallow: ["/admin", "/api"],
      },
    ],
    sitemap: "https://equityroots.in/sitemap.xml",
  };
}
