import JSZip from 'jszip';
import { nameFromUrl, readScreenshot } from '../screenshots';
import { VIEWPORTS } from '../viewports';
import type { ExtractionResult, ViewportLabel } from '../types';

/**
 * Package everything into one download.
 *
 * The bundle is what a user hands to their agent or drops into a project, so
 * it carries the brief, the tokens, the code and the reference screenshots
 * together — a prompt without its screenshots loses the visual ground truth.
 */
export async function buildZip(result: ExtractionResult): Promise<Buffer> {
  const zip = new JSZip();

  for (const file of result.files) {
    zip.file(file.path, file.contents);
  }

  const shots = zip.folder('screenshots');
  for (const [viewport, url] of Object.entries(result.assets.screenshots)) {
    if (!url) continue;
    // Screenshots live on disk rather than in memory; a missing one should not
    // cost the user the rest of the bundle.
    const data = await readScreenshot(nameFromUrl(url));
    if (data) {
      shots?.file(`${viewport}.jpg`, data);
    } else {
      shots?.file(`${viewport}.MISSING.txt`, `Screenshot for ${viewport} was not written to disk.`);
    }
  }

  zip.file('README.md', bundleReadme(result));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Names the widths: "at each viewport" tells a reader nothing they can check
 *  their own build against. */
function shotsLine(result: ExtractionResult): string {
  const shots = Object.keys(result.assets.screenshots) as ViewportLabel[];
  if (!shots.length) return '- `screenshots/` — empty; no screenshots were captured for this run.';
  return `- \`screenshots/\` — full-page renders (entire scroll height, ${result.page.documentHeight}px) at ${shots
    .map((vp) => `**${vp} ${VIEWPORTS[vp]?.width ?? '—'}px**`)
    .join(', ')}. Compare your build against them.`;
}

function bundleReadme(result: ExtractionResult): string {
  const brandAssets = result.assets.images.filter((i) => i.isBrandAsset);

  return [
    `# Design extraction — ${result.page.title || result.page.finalUrl}`,
    '',
    `Extracted from ${result.page.finalUrl} on ${result.page.extractedAt}.`,
    '',
    '## Start here',
    '',
    '- **`AGENT_PROMPT.md`** — paste into Claude Code, Cursor, or any coding agent.',
    '  It is the complete build brief and the reason this bundle exists. Its §0 explains',
    '  every other file here and the order to read them in.',
    '- `AGENT_PROMPT.compact.md` — the same brief trimmed for small context windows.',
    '',
    '## Files',
    '',
    ...result.files.map((f) => `- \`${f.path}\` — ${f.description}`),
    shotsLine(result),
    '',
    '## What was measured',
    '',
    `- ${result.stats.nodesAnalyzed} elements analyzed`,
    `- ${result.stats.colorsFound} distinct colors, ${result.stats.sectionsFound} sections`,
    `- ${result.stats.componentsDetected} repeating components detected`,
    result.stats.inaccessibleSheets > 0
      ? `- ${result.stats.inaccessibleSheets} stylesheet(s) were cross-origin and could not be read directly; their effects were still captured through computed styles.`
      : '',
    '',
    '## Using this',
    '',
    'The design system here was measured from rendered output and is yours to build on.',
    'The copy, photography and logos are not: they belong to the source site.',
    brandAssets.length
      ? `This extraction includes ${brandAssets.length} brand asset(s) — marked \`⚠ brand\` in the brief — that must be replaced with your own.`
      : 'No brand assets were detected, but check images before reusing any of them.',
    '',
    'Re-run the extraction with content mode set to **placeholder** to get the same',
    'structure with the source text swapped for stand-in copy of matching length.',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
