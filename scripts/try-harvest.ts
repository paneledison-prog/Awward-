import { openPage, loadAndSettle, VIEWPORTS } from '../lib/browser';
import { harvest } from '../lib/extract/harvest';
import { writeFileSync } from 'node:fs';

async function main() {
  const url = process.argv[2] ?? 'http://127.0.0.1:4321/marketing.html';
  const session = await openPage(VIEWPORTS.desktop);
  await loadAndSettle(session.page, url, 30_000);
  const result = await harvest(session.page, url, VIEWPORTS.desktop);
  await session.close();

  // This is the recorded input the inference tests run against, so re-record it
  // whenever the harvest shape changes.
  writeFileSync('test/fixtures/harvest-marketing.json', JSON.stringify(result, null, 2));
  console.log('title       :', result.title);
  console.log('docHeight   :', result.documentHeight);
  console.log('nodes       :', result.nodes.length, '(truncated:', result.stats.truncated + ')');
  console.log('mediaQueries:', result.mediaQueries);
  console.log('cssVars     :', Object.keys(result.cssVariables).length);
  console.log('fonts       :', result.fonts.map(f => f.family + ':' + f.weight).join(', ') || '(none)');
  console.log('sheets      :', result.stats.sheetCount, 'rules:', result.stats.ruleCount,
              'inaccessible:', result.stats.inaccessibleSheets);
  console.log('\nTop-level sections:');
  for (const n of result.nodes.filter(n => n.depth === 1)) {
    console.log(`  ${n.tag.padEnd(8)} area=${String(n.area).padStart(8)} y=${String(n.box[1]).padStart(5)} "${n.subtreeText.slice(0,46)}"`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
