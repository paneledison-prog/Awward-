/**
 * Seed a finished extraction from the recorded harvest, with no browser.
 *
 * `analyze` is everything after rendering, so feeding it the fixture produces a
 * genuine result — the same object a real run stores. That makes the read-side
 * tools (list_components, get_component, get_brief, the download route)
 * testable in an environment that cannot run Chromium.
 *
 * Usage: npm run seed:result [-- --component]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../lib/extract';
import { buildComponentSection, sliceSubtree } from '../lib/extract/component';
import { buildSections } from '../lib/extract/sections';
import { saveResult } from '../lib/results';
import type { ExtractOptions, HarvestResult } from '../lib/types';

async function main() {
  const wantComponent = process.argv.includes('--component');

  let harvest: HarvestResult = JSON.parse(
    readFileSync(join(__dirname, '../../test/fixtures/harvest-marketing.json'), 'utf8'),
  );

  let selector: string | undefined;
  if (wantComponent) {
    const pricing = buildSections(harvest).find((s) => s.kind === 'pricing');
    if (!pricing) throw new Error('the fixture has no pricing section');
    const node = harvest.nodes.find((n) => n.sel === pricing.selector);
    if (!node) throw new Error('no node for the pricing section');

    selector = '.pricing';
    harvest = sliceSubtree(harvest, node.i);
    harvest.root = { ...harvest.root!, selector };
    // Prove the scoped path produces one classified component before analysing.
    console.log(`component: ${buildComponentSection(harvest).kind}, ${harvest.nodes.length} nodes`);
  }

  const id = wantComponent ? 'seed-component' : 'seed-page';
  const options: ExtractOptions = {
    url: harvest.finalUrl,
    selector,
    contentMode: 'verbatim',
    viewports: ['desktop'],
    emitReact: true,
    emitHtml: true,
  };

  const result = await analyze({
    jobId: id,
    requestedUrl: harvest.finalUrl,
    primary: harvest,
    others: [],
    network: [],
    screenshots: {},
    contentMode: 'verbatim',
    emitReact: true,
    emitHtml: true,
    warnings: [],
    startedAt: Date.now(),
    onProgress: () => {},
  });

  await saveResult(id, { options, result });
  console.log(
    `seeded ${id}: ${result.sections.length} section(s), ${result.files.length} files, ` +
      `${result.stats.colorsFound} colors`,
  );
}

void main();
