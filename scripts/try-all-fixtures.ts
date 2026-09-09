import { runExtraction } from '../lib/extract';
import { closeBrowser } from '../lib/browser';

async function main() {
  for (const name of ['marketing', 'dark-app', 'plain']) {
    const url = `http://127.0.0.1:4321/${name}.html`;
    process.stdout.write(`\n${'='.repeat(72)}\n${name}.html\n${'='.repeat(72)}\n`);
    try {
      const r = await runExtraction(name, {
        url, contentMode: 'verbatim',
        viewports: ['desktop', 'tablet', 'mobile'],
        emitReact: true, emitHtml: true,
      }, () => {});
      console.log('theme    :', r.design.palette.isDark ? 'dark' : 'light');
      console.log('roles    :', Object.entries(r.design.palette.roles).map(([k,v])=>`${k}=${v}`).join(' '));
      console.log('fonts    :', r.design.families.map(f=>`${f.primary}/${f.usage}`).join(', ') || '(none)');
      console.log('body size:', r.design.typeScale.find(t=>t.name==='body')?.fontSize + 'px',
                  '| scale steps:', r.design.typeScale.length);
      console.log('spacing  :', r.design.spacing.baseUnit + 'px base,',
                  Math.round(r.design.spacing.confidence*100) + '% fit');
      console.log('container:', r.design.container.maxWidth, '| breakpoints:', r.design.breakpoints.join(','));
      console.log('radii    :', r.design.radii.map(x=>`${x.name}=${x.value}`).join(' ') || '(none)');
      console.log('sections :', r.sections.map(s=>s.kind).join(' → '));
      console.log('repeats  :', r.sections.filter(s=>s.repeat).map(s=>`${s.repeat!.count}x${s.repeat!.componentName}`).join(' ') || '(none)');
      console.log('files    :', r.files.length, '| prompt', r.agentPrompt.length, 'chars');
      console.log('warnings :', r.page.warnings.length ? r.page.warnings.join(' | ') : '(none)');
    } catch (e) {
      console.error('FAILED:', e instanceof Error ? e.message : e);
    }
  }
  await closeBrowser();
}
main().catch((e) => { console.error(e); process.exit(1); });
