import { writeFileSync } from 'node:fs';
import { inPageHarvest } from '../lib/extract/harvest';

/**
 * Generate the extension's harvest file from the real implementation.
 *
 * The extension cannot import TypeScript, and a hand-copied duplicate of a
 * 300-line DOM walk would drift within a week. Serializing the function keeps
 * one source of truth; `npm run build:extension` regenerates it and CI checks
 * the committed copy still matches.
 */
const banner = `/* GENERATED — do not edit. Run \`npm run build:extension\`. */
/* Source: lib/extract/harvest.ts */`;

const body = `${banner}
(() => {
  const harvestFn = ${inPageHarvest.toString()};

  const raw = harvestFn(3000);
  const w = window.innerWidth;
  const label = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';

  const harvest = {
    requestedUrl: location.href,
    ...raw,
    viewport: { width: w, height: window.innerHeight, label },
  };

  const network = performance.getEntriesByType('resource').slice(0, 400).map((e) => ({
    url: e.name,
    type: e.initiatorType || '',
    status: 200,
  }));

  return { harvest, network };
})();
`;

writeFileSync('extension/harvest.js', body);
console.log(`extension/harvest.js written (${(body.length / 1024).toFixed(1)}KB)`);
