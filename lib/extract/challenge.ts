import type { HarvestResult } from '../types';

/**
 * Detect that a bot-protection interstitial was extracted instead of the site.
 *
 * Without this the extraction "succeeds": the challenge page has a background,
 * a font and a heading, so a palette and a type scale come back and the result
 * looks entirely normal. It is just the design system of a CAPTCHA page,
 * presented as though it were the site's. Silently wrong output is worse than
 * a clear failure, which is what this turns it into.
 */

/** Phrases these interstitials use. Matched against the page's visible text. */
const CHALLENGE_PHRASES = [
  'verify you are human',
  'checking your browser',
  'just a moment',
  'performing security verification',
  'attention required',
  'ddos protection by',
  'enable javascript and cookies to continue',
  'please verify you are a human',
  'access denied',
  'why have i been blocked',
  'request blocked',
  'unusual traffic from your computer',
  'are you a robot',
];

/** Vendors, named so the report can say who blocked it. */
const VENDORS: [RegExp, string][] = [
  [/cloudflare|cf-ray|ray id/i, 'Cloudflare'],
  [/akamai|reference #\d/i, 'Akamai'],
  [/perimeterx|px-captcha/i, 'PerimeterX'],
  [/datadome/i, 'DataDome'],
  [/imperva|incapsula/i, 'Imperva'],
  [/hcaptcha/i, 'hCaptcha'],
  [/recaptcha/i, 'reCAPTCHA'],
];

export interface ChallengeVerdict {
  blocked: boolean;
  vendor: string;
  evidence: string;
}

export function detectChallenge(harvest: HarvestResult): ChallengeVerdict | null {
  const text = harvest.nodes
    .map((n) => n.text)
    .join(' ')
    .toLowerCase();
  const title = harvest.title.toLowerCase();

  const phrase = CHALLENGE_PHRASES.find((p) => text.includes(p) || title.includes(p));

  // A challenge page is also tiny. Requiring both keeps a real page that merely
  // mentions one of these phrases — a security product's own marketing site,
  // say — from being reported as blocked.
  const isMinimal = harvest.nodes.length < 60;

  if (!phrase || !isMinimal) return null;

  const haystack = `${text} ${title} ${harvest.finalUrl}`;
  const vendor = VENDORS.find(([re]) => re.test(haystack))?.[1] ?? 'a bot-protection service';

  return {
    blocked: true,
    vendor,
    evidence: phrase,
  };
}

/**
 * The right advice depends on which browser did the rendering, and the two are
 * opposites: a server-side block is solved by measuring in your own browser,
 * while a browser-side one means the challenge simply had not cleared yet.
 */
export function challengeMessage(
  verdict: ChallengeVerdict,
  url: string,
  source: 'server' | 'browser' = 'server',
): string {
  const seen = `${url} served a ${verdict.vendor} bot check instead of the page (matched "${verdict.evidence}").`;

  if (source === 'browser') {
    return [
      seen,
      'The harvest captured the check rather than the site — it was still on screen',
      'when the snippet ran. Wait for the real page to finish loading, then run it again.',
    ].join(' ');
  }

  return [
    seen,
    'The site does not serve automated browsers, and nothing here will change that.',
    'But you can open it yourself: use "Run it in your own browser" on the DesignDNA',
    'front page to measure the site in the tab you already have open. Same measurement,',
    'same output — it just runs where the page actually loads.',
  ].join(' ');
}
