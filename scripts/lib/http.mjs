// EARTHSCOPE data-build helpers: polite fetching (bounded concurrency,
// exponential backoff with jitter on 429/5xx/network errors) and a gzip
// on-disk cache of every raw response so build scripts are resumable.
//
// Used by scripts/build-*.mjs and scripts/build-atlas.ts. Node >= 20.

import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RAW_DIR = resolve(ROOT, "data-raw");
export const USER_AGENT = "EARTHSCOPE-data-build/1.0 (NASA Space Apps 2026 student project; node fetch)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal p-limit: returns a function that runs async tasks with at most `n` in flight. */
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, res, rej } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(res, rej)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((res, rej) => {
      queue.push({ fn, res, rej });
      next();
    });
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

/**
 * fetch() with retries. Retries on network errors (ECONNRESET, socket closed,
 * timeouts) and on 408/429/5xx with exponential backoff + full jitter.
 * Returns { status, headers, body: Buffer, url }.
 * Non-retryable HTTP errors are returned (not thrown) so callers can inspect them.
 */
export async function politeFetch(url, { retries = 6, timeoutMs = 120_000, baseDelayMs = 1500, headers = {}, log = true } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const body = Buffer.from(await r.arrayBuffer());
      if (RETRY_STATUS.has(r.status) && attempt < retries) {
        const ra = Number(r.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt, baseDelayMs);
        if (log) console.warn(`  [retry ${attempt + 1}/${retries}] HTTP ${r.status} ${short(url)} — waiting ${Math.round(wait)} ms`);
        await sleep(wait);
        continue;
      }
      return { status: r.status, headers: r.headers, body, url: r.url };
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      const wait = backoff(attempt, baseDelayMs);
      if (log) console.warn(`  [retry ${attempt + 1}/${retries}] ${e.name}: ${e.cause?.code ?? e.message} ${short(url)} — waiting ${Math.round(wait)} ms`);
      await sleep(wait);
    }
  }
  throw new Error(`politeFetch failed after ${retries + 1} attempts: ${url}: ${lastErr?.cause?.code ?? lastErr?.message}`);
}

function backoff(attempt, base) {
  const cap = Math.min(60_000, base * 2 ** attempt);
  return cap / 2 + Math.random() * (cap / 2); // "equal jitter"
}

function short(u) {
  return u.length > 110 ? u.slice(0, 107) + "..." : u;
}

export async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Atomically write a file (write tmp + rename), creating parent dirs. */
export async function writeFileAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/**
 * Fetch `url`, caching the raw body gzipped at `cachePath` (+ a small .meta.json
 * with status, content-type, CORS header, retrieval time). If the cache exists it
 * is used and no request is made. `validate(body, status, headers)` must return
 * true for the response to be cached; otherwise an Error is thrown.
 * Returns { body: Buffer, meta, fromCache }.
 */
export async function cachedFetch(url, cachePath, { validate = (b, s) => s === 200, ...fetchOpts } = {}) {
  const metaPath = cachePath.replace(/\.gz$/, "") + ".meta.json";
  if (await exists(cachePath)) {
    const body = gunzipSync(await readFile(cachePath));
    let meta = {};
    try {
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    } catch {}
    return { body, meta, fromCache: true };
  }
  const res = await politeFetch(url, fetchOpts);
  if (!validate(res.body, res.status, res.headers)) {
    const snippet = res.body.subarray(0, 300).toString("utf8").replace(/\s+/g, " ");
    const err = new Error(`Invalid response HTTP ${res.status} for ${url}: ${snippet}`);
    err.status = res.status;
    err.body = res.body;
    throw err;
  }
  const meta = {
    url,
    finalUrl: res.url,
    status: res.status,
    contentType: res.headers.get("content-type"),
    accessControlAllowOrigin: res.headers.get("access-control-allow-origin"),
    bytes: res.body.length,
    retrieved: new Date().toISOString(),
  };
  await writeFileAtomic(cachePath, gzipSync(res.body));
  await writeFileAtomic(metaPath, JSON.stringify(meta, null, 2));
  return { body: res.body, meta, fromCache: false };
}

/** Write pretty-ish JSON (compact for arrays of numbers) with trailing newline. */
export async function writeJson(path, obj, { pretty = true } = {}) {
  await writeFileAtomic(path, (pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)) + "\n");
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
