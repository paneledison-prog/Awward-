/**
 * Turns whatever the user typed into a URL worth extracting, and checks that
 * the target permits it.
 *
 * Users type "stripe", "stripe.com", "https://stripe.com/pricing" and
 * "Stripe payments" interchangeably. Guessing wrong wastes a 40-second
 * extraction, so ambiguous input produces ranked candidates for the user to
 * confirm rather than a silent pick.
 */

const TLDS = ['com', 'io', 'co', 'app', 'dev', 'ai', 'org', 'net'];
const FETCH_TIMEOUT_MS = 8_000;

export interface SiteCandidate {
  url: string;
  title: string;
  description: string;
  favicon: string;
  reachable: boolean;
}

export interface ResolveOutcome {
  /** Set when the input was unambiguously a URL. */
  direct?: string;
  candidates: SiteCandidate[];
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** True when the string is already a URL rather than a bare name. */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  // A dot followed by a plausible TLD, with no spaces, is a hostname.
  return /^[^\s/]+\.[a-z]{2,63}(\/.*)?$/i.test(trimmed);
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  // Strip tracking params so the same page does not extract under many ids.
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref$|ref_)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

/** Slugify a typed name into the hostname label people actually register. */
function toHostLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '');
}

function extractTag(html: string, re: RegExp): string {
  const m = html.match(re);
  return m?.[1]?.trim().replace(/\s+/g, ' ').slice(0, 200) ?? '';
}

/** Fetch just enough of a page to describe it in the candidate picker. */
async function probe(url: string): Promise<SiteCandidate | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: withTimeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'DesignDNA/1.0 (+site resolution)', Accept: 'text/html' },
    });
    if (!res.ok) return null;

    const finalUrl = res.url || url;
    // Only the <head> is needed; abandon the rest of the body.
    const html = (await res.text()).slice(0, 60_000);

    return {
      url: finalUrl,
      title:
        extractTag(html, /<title[^>]*>([^<]{1,200})<\/title>/i) ||
        new URL(finalUrl).hostname,
      description: extractTag(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i,
      ),
      favicon: `https://www.google.com/s2/favicons?domain=${new URL(finalUrl).hostname}&sz=64`,
      reachable: true,
    };
  } catch {
    return null;
  }
}

export async function resolveInput(input: string): Promise<ResolveOutcome> {
  const trimmed = input.trim();
  if (!trimmed) return { candidates: [] };

  if (looksLikeUrl(trimmed)) {
    return { direct: normalizeUrl(trimmed), candidates: [] };
  }

  const label = toHostLabel(trimmed);
  if (!label) return { candidates: [] };

  // Probe every TLD at once — sequential probing would take most of a minute.
  const results = await Promise.all(TLDS.map((tld) => probe(`https://${label}.${tld}`)));

  const candidates = results.filter((c): c is SiteCandidate => c !== null);

  // A .com that resolves is overwhelmingly the intended site; keep TLD order
  // otherwise, since it already runs most-likely-first.
  return { candidates };
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

export interface RobotsVerdict {
  allowed: boolean;
  reason: string;
}

interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

/**
 * Parse robots.txt into agent groups.
 *
 * Consecutive `User-agent` lines share one rule set; a `User-agent` line that
 * follows a rule starts a new group. Getting this wrong merges every site's
 * rules together, which would make an unrelated crawler's Disallow block us.
 */
function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return groups;
}

function matchesRobotsPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    '^' +
      body
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      (anchored ? '$' : ''),
  );
  return regex.test(path);
}

/**
 * Decide whether our crawler may fetch `path`.
 *
 * A group naming us specifically wins over the `*` group. Within the chosen
 * group the longest matching pattern wins, so a narrow `Allow` correctly
 * re-opens a path a broad `Disallow` closed.
 */
export function evaluateRobots(robotsTxt: string, path: string): RobotsVerdict {
  const groups = parseRobots(robotsTxt);
  if (groups.length === 0) return { allowed: true, reason: 'No rules in robots.txt' };

  const specific = groups.find((g) => g.agents.some((a) => a.includes('designdna')));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const group = specific ?? wildcard;
  if (!group) return { allowed: true, reason: 'No robots.txt group applies to this crawler' };

  let best: { allow: boolean; length: number; pattern: string } | null = null;
  for (const rule of group.rules) {
    // An empty Disallow value means "allow everything" and matches nothing.
    if (rule.pattern === '') continue;
    if (!matchesRobotsPattern(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.length) {
      best = { allow: rule.allow, length: rule.pattern.length, pattern: rule.pattern };
    }
  }

  if (!best) return { allowed: true, reason: 'No matching robots.txt rule' };
  return best.allow
    ? { allowed: true, reason: `Allowed by robots.txt rule "Allow: ${best.pattern}"` }
    : {
        allowed: false,
        reason: `robots.txt disallows this path (rule "Disallow: ${best.pattern}")`,
      };
}

export async function checkRobots(targetUrl: string): Promise<RobotsVerdict> {
  try {
    const url = new URL(targetUrl);
    const res = await fetch(new URL('/robots.txt', url).toString(), {
      signal: withTimeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'DesignDNA/1.0' },
    });
    // A missing or erroring robots.txt states no restriction.
    if (!res.ok) return { allowed: true, reason: 'No robots.txt published' };
    const text = (await res.text()).slice(0, 200_000);
    return evaluateRobots(text, url.pathname || '/');
  } catch {
    // A network failure here must not block extraction; the render step will
    // surface a genuine connectivity problem with a far clearer error.
    return { allowed: true, reason: 'robots.txt unreachable' };
  }
}
