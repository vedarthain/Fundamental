/**
 * Postgres connection — reads from .env.local at the repo root.
 * Two pools: `app` (writable, our scoring DB) and `golden` (read-only, prices+indicators).
 *
 * In Next.js dev, modules can be re-evaluated; we cache pools on globalThis to avoid
 * leaking connections.
 */
import "server-only";
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __nse_app_pool: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __nse_golden_pool: ReturnType<typeof postgres> | undefined;
}

function makePool(connStr: string) {
  return postgres(connStr, {
    max: 8,
    idle_timeout: 30,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}

function getAppPool(): ReturnType<typeof postgres> {
  if (!globalThis.__nse_app_pool) {
    const url = process.env.APP_DB_URL;
    if (!url) throw new Error("APP_DB_URL missing from environment (.env.local)");
    globalThis.__nse_app_pool = makePool(url);
  }
  return globalThis.__nse_app_pool;
}

function getGoldenPool(): ReturnType<typeof postgres> {
  if (!globalThis.__nse_golden_pool) {
    const url = process.env.GOLDEN_DB_URL;
    if (!url) throw new Error("GOLDEN_DB_URL missing from environment (.env.local)");
    globalThis.__nse_golden_pool = makePool(url);
  }
  return globalThis.__nse_golden_pool;
}

export const sql: ReturnType<typeof postgres> = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, argArray) {
    return Reflect.apply(getAppPool(), _thisArg, argArray);
  },
  get(_target, prop) {
    return Reflect.get(getAppPool(), prop);
  },
});

export const golden: ReturnType<typeof postgres> = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
  apply(_target, _thisArg, argArray) {
    return Reflect.apply(getGoldenPool(), _thisArg, argArray);
  },
  get(_target, prop) {
    return Reflect.get(getGoldenPool(), prop);
  },
});

