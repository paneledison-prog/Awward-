import type { HarvestNetworkEntry } from '../types';

/**
 * Recover media queries from stylesheets the page could not read.
 *
 * The CSSOM refuses to expose rules from a cross-origin stylesheet without CORS
 * headers, so breakpoints declared only in a CDN-hosted file are invisible from
 * inside the page — the layout is measured correctly at each viewport, but the
 * widths it changes at are lost.
 *
 * The server is not bound by the same-origin policy, so it can fetch those
 * files directly and read the `@media` conditions out of the text.
 */

const MAX_SHEETS = 12;
const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

/** Matches the condition of any `@media` rule, without needing a CSS parser. */
const MEDIA_RE = /@media\s+([^{]{1,200})\{/g;

function isStylesheet(entry: HarvestNetworkEntry): boolean {
  if (/text\/css/i.test(entry.type)) return true;
  if (entry.type === 'css' || entry.type === 'link') return /\.css(\?|$)/i.test(entry.url);
  return /\.css(\?|$)/i.test(entry.url);
}

async function fetchConditions(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'DesignDNA/1.0 (+stylesheet analysis)' },
    });
    if (!res.ok) return [];

    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return [];

    const text = (await res.text()).slice(0, MAX_BYTES);
    return [...text.matchAll(MEDIA_RE)].map((m) => m[1].trim());
  } catch {
    // A stylesheet that cannot be fetched simply contributes nothing; it must
    // not fail the extraction that has otherwise already succeeded.
    return [];
  }
}

export async function recoverMediaQueries(
  network: HarvestNetworkEntry[],
  pageUrl: string,
): Promise<{ queries: string[]; fetched: number }> {
  let pageOrigin = '';
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    return { queries: [], fetched: 0 };
  }

  const candidates = [
    ...new Set(
      network
        .filter(isStylesheet)
        .map((e) => e.url)
        .filter((url) => {
          try {
            // Same-origin sheets were already readable from the page; only the
            // ones the CSSOM refused are worth a network round trip.
            return new URL(url).origin !== pageOrigin && /^https?:/.test(url);
          } catch {
            return false;
          }
        }),
    ),
  ].slice(0, MAX_SHEETS);

  const results = await Promise.all(candidates.map(fetchConditions));

  return {
    queries: [...new Set(results.flat())],
    fetched: candidates.length,
  };
}
