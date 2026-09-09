import { runExtraction } from '../lib/extract';
import { closeBrowser } from '../lib/browser';

async function attempt(label: string, url: string) {
  process.stdout.write(`\n── ${label} ──\n`);
  try {
    const r = await runExtraction(label, {
      url, contentMode: 'verbatim', viewports: ['desktop'], emitReact: false, emitHtml: false,
    }, () => {});
    console.log('  result     : completed');
    console.log('  breakpoints:', r.design.breakpoints.join(', ') || '(none)');
    r.page.warnings.forEach(w => console.log('  warning    :', w));
  } catch (e) {
    console.log('  rejected   :', e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  await attempt('403-page', 'http://127.0.0.1:4321/403');
  await attempt('cross-origin-css', 'http://127.0.0.1:4321/cross-origin.html');
  await closeBrowser();
}
main().catch((e) => { console.error(e); process.exit(1); });
