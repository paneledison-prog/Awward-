import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildPalette, nameColor, parseColor } from '../lib/extract/colors';
import { buildTypeScale, primaryFamily } from '../lib/extract/typography';
import { buildSpacingScale } from '../lib/extract/spacing';
import { buildBreakpoints, buildContainer, buildMotion, buildRadii } from '../lib/extract/effects';
import { buildSections } from '../lib/extract/sections';
import { describeHttpFailure } from '../lib/browser';
import { challengeMessage, detectChallenge } from '../lib/extract/challenge';
import { evaluateRobots, looksLikeUrl, normalizeUrl } from '../lib/resolve';
import { placeholder } from '../lib/emit/content';
import type { HarvestResult } from '../lib/types';

/**
 * These run against a recorded harvest rather than a live browser: the harvest
 * is the only part of the pipeline that needs Chromium, and everything after it
 * is a pure function of that array.
 */
// Regenerate with `npm run record-fixture` after changing the harvest shape.
const harvest: HarvestResult = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/harvest-marketing.json'), 'utf8'),
);

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

test('parseColor handles the notations a computed style returns', () => {
  assert.equal(parseColor('rgb(79, 70, 229)')?.hex, '#4f46e5');
  assert.equal(parseColor('#4F46E5')?.hex, '#4f46e5');
  assert.equal(parseColor('rgba(79, 70, 229, 0.5)')?.alpha, 0.5);
  assert.equal(parseColor('transparent'), null);
  assert.equal(parseColor('rgba(0, 0, 0, 0)'), null);
  assert.equal(parseColor(''), null);
});

test('nameColor puts tinted neutrals on the neutral ramp, not a hue ramp', () => {
  // Slate carries enough chroma to be misread as indigo.
  assert.match(nameColor(parseColor('#64748b')!.oklch), /^neutral-/);
  assert.match(nameColor(parseColor('#0f172a')!.oklch), /^neutral-/);
  assert.match(nameColor(parseColor('#4f46e5')!.oklch), /^(indigo|violet|blue)-/);
});

test('buildPalette recovers the roles the fixture actually declares', () => {
  const palette = buildPalette(harvest.nodes);
  assert.equal(palette.isDark, false);
  assert.equal(palette.roles.background, '#ffffff');
  assert.equal(palette.roles.surface, '#f8fafc');
  assert.equal(palette.roles.foreground, '#0f172a');
  assert.equal(palette.roles.muted, '#64748b');
  assert.equal(palette.roles.primary, '#4f46e5');
  assert.equal(palette.roles.border, '#e2e8f0');
});

test('buildPalette keeps #ffffff and #f8fafc as separate tokens', () => {
  // They are only 0.016 apart in OKLab; merging them loses the surface color.
  const hexes = buildPalette(harvest.nodes).tokens.map((t) => t.hex);
  assert.ok(hexes.includes('#ffffff'));
  assert.ok(hexes.includes('#f8fafc'));
});

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

test('primaryFamily skips generic families in a stack', () => {
  assert.equal(primaryFamily('Inter, -apple-system, sans-serif'), 'Inter');
  assert.equal(primaryFamily('"Segoe UI", system-ui, sans-serif'), 'Segoe UI');
  assert.equal(primaryFamily('system-ui, sans-serif'), 'system-ui');
});

test('type scale names heading tags from the tags themselves', () => {
  const { scale } = buildTypeScale(harvest.nodes);
  const h1 = scale.find((t) => t.name === 'h1');
  const h2 = scale.find((t) => t.name === 'h2');
  assert.equal(h1?.fontSize, 64);
  assert.equal(h1?.fontWeight, 700);
  assert.equal(h2?.fontSize, 40);
});

test('type scale separates identical sizes at different weights', () => {
  // 20px appears as both a 600-weight card heading and 400-weight body copy.
  const { scale } = buildTypeScale(harvest.nodes);
  const twenties = scale.filter((t) => t.fontSize === 20);
  assert.ok(twenties.length > 1, 'expected more than one 20px step');
  const h3 = scale.find((t) => t.name === 'h3');
  assert.equal(h3?.fontSize, 20);
  assert.equal(h3?.fontWeight, 600, 'h3 must keep its own weight, not body copy’s');
});

test('every type token name is unique', () => {
  const names = buildTypeScale(harvest.nodes).scale.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

/* ------------------------------------------------------------------ */
/* Spacing                                                             */
/* ------------------------------------------------------------------ */

test('spacing prefers the coarsest grid that explains the values', () => {
  // Every value here is a multiple of 2 and of 4, but 8 is the real grid.
  const nodes = [8, 16, 24, 32, 48, 64].flatMap((px) =>
    Array.from({ length: 4 }, () => styleNode({ paddingTop: `${px}px` })),
  );
  assert.equal(buildSpacingScale(nodes).baseUnit, 8);
});

test('spacing reports low confidence for a page with no grid', () => {
  const nodes = [7, 13, 19, 23, 29, 31].flatMap((px) =>
    Array.from({ length: 4 }, () => styleNode({ paddingTop: `${px}px` })),
  );
  const scale = buildSpacingScale(nodes);
  assert.ok(scale.confidence < 0.5, `expected low confidence, got ${scale.confidence}`);
});

test('spacing scale on the fixture excludes one-off values', () => {
  const scale = buildSpacingScale(harvest.nodes);
  assert.ok(scale.values.includes(96));
  assert.ok(scale.values.includes(24));
  assert.ok(scale.values.every((v) => v > 0));
});

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

test('breakpoints convert max-width queries to the width above them', () => {
  assert.deepEqual(buildBreakpoints(['(max-width: 768px)']), [769]);
  assert.deepEqual(buildBreakpoints(['(min-width: 1024px)']), [1024]);
  // em units in a media query resolve against a 16px root.
  assert.deepEqual(buildBreakpoints(['(min-width: 48em)']), [768]);
  assert.deepEqual(buildBreakpoints(['screen and (max-width: 1px)']), []);
});

test('motion splits multi-value transition lists on top-level commas only', () => {
  const nodes = [
    styleNode({
      transitionDuration: '0.2s, 0.2s',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1), ease-out',
    }),
    styleNode({
      transitionDuration: '0.2s',
      transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    }),
  ];
  const motion = buildMotion(nodes, []);
  assert.deepEqual(
    motion.durations.map((d) => d.value),
    ['0.2s'],
  );
  // The commas inside cubic-bezier() must not split it into fragments.
  assert.ok(motion.easings.some((e) => e.value === 'cubic-bezier(0.4, 0, 0.2, 1)'));
});

test('radii and container come back off the fixture', () => {
  const radii = buildRadii(harvest.nodes);
  assert.deepEqual(
    radii.map((r) => r.value),
    ['6px', '12px', '20px'],
  );
  assert.equal(buildContainer(harvest.nodes, harvest.viewport.width).maxWidth, 1200);
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

test('sections are found in order and classified', () => {
  const sections = buildSections(harvest);
  assert.deepEqual(
    sections.map((s) => s.kind),
    ['nav', 'hero', 'logo-cloud', 'feature-grid', 'testimonial', 'pricing', 'cta', 'footer'],
  );
});

test('repeating groups become one component with its items', () => {
  const sections = buildSections(harvest);
  const features = sections.find((s) => s.kind === 'feature-grid');
  assert.equal(features?.repeat?.count, 6);
  assert.equal(features?.repeat?.columns, 3);
  assert.equal(features?.repeat?.componentName, 'FeatureCard');
  assert.equal(features?.repeat?.items[0].heading, 'Unified API');

  const pricing = sections.find((s) => s.kind === 'pricing');
  assert.equal(pricing?.repeat?.count, 3);
  assert.equal(pricing?.repeat?.componentName, 'PricingTier');
});

test('nav and footer are not given a pseudo-heading', () => {
  const sections = buildSections(harvest);
  assert.equal(sections.find((s) => s.kind === 'nav')?.heading, '');
  assert.equal(sections.find((s) => s.kind === 'footer')?.heading, '');
});

test('logo-cloud images are flagged as brand assets', () => {
  const logos = buildSections(harvest).find((s) => s.kind === 'logo-cloud');
  assert.ok(logos!.images.length >= 5);
  assert.ok(logos!.images.every((i) => i.role === 'logo' && i.isBrandAsset));
});

/* ------------------------------------------------------------------ */
/* HTTP failures                                                       */
/* ------------------------------------------------------------------ */

test('error responses are described rather than extracted', () => {
  assert.equal(describeHttpFailure(200, 'https://a.com'), null);
  assert.equal(describeHttpFailure(301, 'https://a.com'), null);

  // Narrowed once here: every code below returns a string by construction.
  const describe = (status: number): string => {
    const message = describeHttpFailure(status, 'https://a.com');
    assert.ok(message, `expected HTTP ${status} to be described`);
    return message;
  };

  assert.match(describe(403), /refused the request \(HTTP 403\)/);
  // 403 is the case the in-browser path exists for, so it must say so.
  assert.match(describe(403), /Run it in your own browser/);

  assert.match(describe(404), /no page at that address/);
  assert.match(describe(500), /server error/);
  assert.match(describe(429), /rate-limiting/);
  // A 404 is not fixed by a different browser, so it must not suggest one.
  assert.doesNotMatch(describe(404), /your own browser/);
});

/* ------------------------------------------------------------------ */
/* Bot-protection interstitials                                        */
/* ------------------------------------------------------------------ */

test('a bot challenge is detected rather than extracted', () => {
  const challenge = {
    ...harvest,
    title: 'replit.com',
    nodes: harvest.nodes.slice(0, 20).map((n, i) =>
      i === 3 ? { ...n, text: 'Verify you are human' } : { ...n, text: '' },
    ),
    finalUrl: 'https://replit.com/',
  };
  const verdict = detectChallenge(challenge);
  assert.ok(verdict, 'expected the challenge page to be flagged');
  assert.equal(verdict.vendor, 'a bot-protection service');
  assert.match(challengeMessage(verdict, 'https://replit.com/'), /bot check instead of the page/);
});

test('a real page is not mistaken for a challenge', () => {
  // The fixture is a normal marketing page: no challenge phrasing, ~125 nodes.
  assert.equal(detectChallenge(harvest), null);
});

test('a large page mentioning the phrasing is not flagged', () => {
  // A security vendor's own site says "verify you are human" in its copy.
  const marketing = {
    ...harvest,
    nodes: harvest.nodes.map((n, i) => (i === 5 ? { ...n, text: 'Verify you are human' } : n)),
  };
  assert.equal(detectChallenge(marketing), null, 'size is what separates the two');
});

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

test('robots.txt applies only the group that matches our agent', () => {
  const txt = [
    'User-agent: BadBot',
    'Disallow: /',
    '',
    'User-agent: *',
    'Disallow: /admin',
  ].join('\n');
  assert.equal(evaluateRobots(txt, '/pricing').allowed, true);
  assert.equal(evaluateRobots(txt, '/admin').allowed, false);
});

test('robots.txt lets a longer Allow re-open a broader Disallow', () => {
  const txt = ['User-agent: *', 'Disallow: /docs', 'Allow: /docs/public'].join('\n');
  assert.equal(evaluateRobots(txt, '/docs/private').allowed, false);
  assert.equal(evaluateRobots(txt, '/docs/public/intro').allowed, true);
});

test('robots.txt wildcards and end anchors', () => {
  const txt = ['User-agent: *', 'Disallow: /*.pdf$'].join('\n');
  assert.equal(evaluateRobots(txt, '/files/report.pdf').allowed, false);
  assert.equal(evaluateRobots(txt, '/files/report.pdf.html').allowed, true);
});

test('an empty Disallow means everything is allowed', () => {
  assert.equal(evaluateRobots('User-agent: *\nDisallow:', '/anything').allowed, true);
  assert.equal(evaluateRobots('', '/anything').allowed, true);
});

/* ------------------------------------------------------------------ */
/* Input handling                                                      */
/* ------------------------------------------------------------------ */

test('URLs are told apart from bare names', () => {
  assert.equal(looksLikeUrl('https://stripe.com'), true);
  assert.equal(looksLikeUrl('stripe.com'), true);
  assert.equal(looksLikeUrl('stripe.com/pricing'), true);
  assert.equal(looksLikeUrl('stripe'), false);
  assert.equal(looksLikeUrl('stripe payments'), false);
});

test('normalizeUrl adds a scheme and drops tracking params', () => {
  assert.equal(normalizeUrl('stripe.com'), 'https://stripe.com/');
  assert.equal(
    normalizeUrl('https://a.com/p?utm_source=x&keep=1#frag'),
    'https://a.com/p?keep=1',
  );
});

/* ------------------------------------------------------------------ */
/* Placeholder content                                                 */
/* ------------------------------------------------------------------ */

test('placeholder text keeps word count, capitalization and punctuation', () => {
  const source = 'Ship payments in days, not quarters.';
  const swapped = placeholder(source);
  assert.notEqual(swapped, source);
  assert.equal(swapped.split(/\s+/).length, source.split(/\s+/).length);
  assert.match(swapped, /^[A-Z]/);
  assert.ok(swapped.endsWith('.'));
  // Deterministic, so re-running an extraction does not reshuffle the copy.
  assert.equal(placeholder(source), swapped);
});

/* ------------------------------------------------------------------ */

type Styles = HarvestResult['nodes'][number]['styles'];

/** A minimal node carrying only the styles a given test cares about. */
function styleNode(styles: Partial<Styles>): HarvestResult['nodes'][number] {
  // Built from the recorded node's own keys, so it stays in step with the
  // HarvestStyles shape without restating all fifty properties here.
  const blank = Object.fromEntries(
    Object.keys(harvest.nodes[0].styles).map((key) => [key, '']),
  ) as unknown as Styles;
  return {
    ...harvest.nodes[0],
    text: '',
    styles: { ...blank, ...styles },
  };
}
