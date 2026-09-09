/**
 * End-to-end check against a running DesignDNA instance, over HTTP only.
 *
 * Exists because the parts of this app most likely to break are the parts unit
 * tests cannot see: whether the server binds somewhere reachable, and whether
 * files written at runtime are actually served. Both have already broken once.
 *
 * Takes a base URL so the same script covers CI, a local container, and
 * `npm start`:
 *
 *   node scripts/smoke-container.mjs [baseUrl] [targetUrl]
 */

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = (args[0] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const TARGET = args[1] ?? process.env.SMOKE_TARGET_URL ?? 'http://127.0.0.1:4321/marketing.html';

/**
 * Strict mode asserts the exact design system the bundled fixture is known to
 * produce. Against any other page those numbers are meaningless, so --loose
 * keeps the checks that hold for every site: the extraction finishes, a palette
 * comes back, screenshots serve, and the bundle downloads.
 */
const STRICT = !process.argv.includes('--loose');

/** Extraction renders three viewports plus a dark pass; allow for a cold start. */
const EXTRACT_TIMEOUT_MS = 240_000;
const POLL_MS = 2_000;

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function fatal(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`base   : ${BASE}`);
  console.log(`target : ${TARGET}`);
  console.log(`mode   : ${STRICT ? 'strict (fixture assertions on)' : 'loose'}\n`);

  /* --- the server is up and serving the app ------------------------------ */
  console.log('serving');
  const home = await fetch(`${BASE}/`).catch((e) => fatal(`GET / failed: ${e.message}`));
  check('GET / returns 200', home.status === 200, `got ${home.status}`);

  /* --- an extraction can be started -------------------------------------- */
  console.log('\nextraction');
  const started = await fetch(`${BASE}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: TARGET,
      contentMode: 'verbatim',
      viewports: ['desktop', 'tablet', 'mobile'],
    }),
  }).catch((e) => fatal(`POST /api/extract failed: ${e.message}`));

  if (started.status !== 202) {
    fatal(`POST /api/extract returned ${started.status}: ${(await started.text()).slice(0, 300)}`);
  }
  const { jobId } = await started.json();
  if (!jobId) fatal('POST /api/extract returned no jobId');
  check('POST /api/extract accepts the job', true);

  /* --- and finishes ------------------------------------------------------ */
  const deadline = Date.now() + EXTRACT_TIMEOUT_MS;
  let result;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/extract/${jobId}`);
    if (!res.ok) fatal(`GET /api/extract/${jobId} returned ${res.status}`);
    const body = await res.json();

    if (body.status === 'error') fatal(`extraction failed: ${body.error}`);
    if (body.status === 'done') {
      result = body.result;
      break;
    }
    await sleep(POLL_MS);
  }
  if (!result) fatal(`extraction did not finish within ${EXTRACT_TIMEOUT_MS / 1000}s`);
  check(`extraction completed in ${(result.page.durationMs / 1000).toFixed(1)}s`, true);

  /* --- it produced the design system the fixture is known to have --------- */
  console.log('\ninference');
  const roles = result.design.palette.roles;
  // Every page has a background and text; the rest depend on how much of a
  // design system the page actually has.
  for (const role of ['background', 'foreground']) {
    check(`role "${role}" resolved`, typeof roles[role] === 'string', 'missing');
  }
  check('at least one section found', result.stats.sectionsFound >= 1, `got ${result.stats.sectionsFound}`);
  check('files emitted', result.files.length >= 5, `got ${result.files.length}`);
  check('agent brief produced', result.agentPrompt.length > 500, `${result.agentPrompt.length} chars`);

  if (STRICT) {
    for (const role of ['surface', 'muted', 'primary', 'border']) {
      check(`role "${role}" resolved`, typeof roles[role] === 'string', 'missing');
    }
    check('8 sections found', result.stats.sectionsFound === 8, `got ${result.stats.sectionsFound}`);
    check(
      '3 repeating components detected',
      result.stats.componentsDetected === 3,
      `got ${result.stats.componentsDetected}`,
    );
    check('at least 15 files emitted', result.files.length >= 15, `got ${result.files.length}`);
    check('agent brief is substantial', result.agentPrompt.length > 5_000, `${result.agentPrompt.length} chars`);
  }

  /* --- screenshots written at runtime are actually served ---------------- *
   * This is the assertion that earns the script its keep: Next serves public/
   * from a manifest built at build time, so runtime-written files there 404
   * while every other check still passes.                                    */
  console.log('\nscreenshots');
  const shots = Object.entries(result.assets.screenshots);
  check(
    STRICT ? 'three viewports captured' : 'at least one viewport captured',
    STRICT ? shots.length === 3 : shots.length >= 1,
    `got ${shots.length}`,
  );
  for (const [viewport, path] of shots) {
    if (!path) {
      check(`${viewport} screenshot present`, false, 'no path');
      continue;
    }
    const res = await fetch(`${BASE}${path}`);
    const type = res.headers.get('content-type') ?? '';
    const bytes = (await res.arrayBuffer()).byteLength;
    check(
      `${viewport} screenshot serves (${Math.round(bytes / 1024)}KB)`,
      res.status === 200 && type.startsWith('image/') && bytes > 10_000,
      `status ${res.status}, type ${type}, ${bytes} bytes`,
    );
  }

  /* --- the bundle downloads ---------------------------------------------- */
  console.log('\nbundle');
  const zip = await fetch(`${BASE}/api/extract/${jobId}/download`);
  const zipBytes = (await zip.arrayBuffer()).byteLength;
  const minZip = STRICT ? 100_000 : 10_000;
  check(
    `ZIP downloads (${Math.round(zipBytes / 1024)}KB)`,
    zip.status === 200 &&
      (zip.headers.get('content-type') ?? '').includes('zip') &&
      zipBytes > minZip,
    `status ${zip.status}, ${zipBytes} bytes`,
  );

  console.log();
  if (failures > 0) fatal(`${failures} check(s) failed`);
  console.log('✓ all checks passed');
}

main().catch((e) => fatal(e instanceof Error ? e.stack ?? e.message : String(e)));
