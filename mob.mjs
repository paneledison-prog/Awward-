import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--disable-dev-shm-usage'] });
for (const [w,h,label] of [[390,844,'iPhone 390'],[360,800,'Android 360'],[320,568,'small 320']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const m = () => p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vp: window.innerWidth }));
  await p.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.fill('input', 'http://127.0.0.1:4321/marketing.html');
  await p.click('button[type=submit]');
  await p.waitForSelector('nav button:has-text("Design system")', { timeout: 180000 });
  await p.waitForTimeout(700);
  const out = [];
  for (const t of ['Agent brief','Design system','Sections','Code','Assets']) {
    await p.click(`nav button:has-text("${t}")`); await p.waitForTimeout(450);
    const r = await m(); out.push(t+' '+(r.doc<=r.vp?'ok':'OVERFLOW '+r.doc+'>'+r.vp));
    if (t==='Sections' && w===390) await p.screenshot({ path: '/tmp/m7-sections.png' });
  }
  console.log(label.padEnd(12)+': '+out.join(' | '));
  await p.close();
}
await b.close();
