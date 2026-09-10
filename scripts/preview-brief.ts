/**
 * Render the agent brief from the recorded harvest, without a browser.
 *
 * The brief is prose as much as data, and the only way to judge prose is to
 * read it. This prints exactly what an extraction would write.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPalette } from '../lib/extract/colors';
import { buildTypeScale, buildFontFamilies } from '../lib/extract/typography';
import { buildSpacingScale } from '../lib/extract/spacing';
import {
  buildBorderWidths,
  buildBreakpoints,
  buildContainer,
  buildMotion,
  buildRadii,
  buildShadows,
} from '../lib/extract/effects';
import { buildComponentSection, sliceSubtree } from '../lib/extract/component';
import { buildSections } from '../lib/extract/sections';
import { buildAssetManifest } from '../lib/extract/assets';
import { emitAgentPrompt, emitCompactPrompt } from '../lib/emit/prompt';
import type { DesignSystem, HarvestResult, PageMeta } from '../lib/types';

const harvest: HarvestResult = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/harvest-marketing.json'), 'utf8'),
);

const palette = buildPalette(harvest.nodes);
const { scale } = buildTypeScale(harvest.nodes);
const design = {
  palette,
  families: buildFontFamilies(harvest.nodes, [], new Set(scale.filter((t) => /h[1-3]/.test(t.tags.join(' '))).map((t) => t.fontSize))),
  typeScale: scale,
  spacing: buildSpacingScale(harvest.nodes),
  radii: buildRadii(harvest.nodes),
  shadows: buildShadows(harvest.nodes),
  borderWidths: buildBorderWidths(harvest.nodes),
  motion: buildMotion(harvest.nodes, harvest.keyframes),
  breakpoints: buildBreakpoints(harvest.mediaQueries),
  container: buildContainer(harvest.nodes, harvest.viewport.width),
  sourceVariables: {},
} as DesignSystem;
const sections = buildSections(harvest);
const assets = buildAssetManifest(harvest, design.families, {
  desktop: '/api/screenshots/demo-desktop.jpg',
  tablet: '/api/screenshots/demo-tablet.jpg',
  mobile: '/api/screenshots/demo-mobile.jpg',
});

const page: PageMeta = {
  requestedUrl: harvest.finalUrl,
  finalUrl: harvest.finalUrl,
  title: harvest.title,
  description: harvest.description,
  lang: harvest.lang,
  themeColor: harvest.meta.themeColor,
  documentHeight: harvest.documentHeight,
  extractedAt: new Date().toISOString(),
  durationMs: 0,
  warnings: [],
};

const bundle = [
  { path: 'tokens/design-tokens.json', description: 'Design tokens as JSON (W3C-ish format).' },
  { path: 'tokens/tokens.css', description: 'The same tokens as CSS custom properties.' },
  { path: 'tailwind.config.ts', description: 'Tailwind theme extension.' },
  { path: 'src/components/Hero.tsx', description: 'React + Tailwind component for the hero section.' },
  { path: 'index.html', description: 'Plain HTML + CSS build of the page.' },
  { path: 'spec.json', description: 'The complete extraction as machine-readable JSON.' },
];

writeFileSync('/tmp/brief.md', emitAgentPrompt(page, design, sections, assets, 'verbatim', bundle).contents);
writeFileSync('/tmp/brief-compact.md', emitCompactPrompt(page, design, sections, 'verbatim', assets).contents);

// The component brief, from the same fixture: slice one section out and render
// it as a scoped extraction would.
const pricing = sections.find((s) => s.kind === 'pricing') ?? sections[0];
const pricingNode = harvest.nodes.find((n) => n.sel === pricing.selector)!;
const sliced = sliceSubtree(harvest, pricingNode.i);
sliced.root = { ...sliced.root!, selector: '.pricing' };
const componentSpec = buildComponentSection(sliced);
const componentDesign = { ...design, palette: buildPalette(sliced.nodes) };

writeFileSync(
  '/tmp/brief-component.md',
  emitAgentPrompt(page, componentDesign, [componentSpec], assets, 'verbatim', bundle, {
    kind: 'component',
    selector: '.pricing',
    box: componentSpec.box,
  }).contents,
);

console.log('wrote /tmp/brief.md, /tmp/brief-compact.md and /tmp/brief-component.md');
