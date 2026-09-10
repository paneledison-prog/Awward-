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
 * The element `extract_component` is pointed at.
 *
 * The fixture page has a `.pricing` section; an arbitrary deployed target may
 * have nothing in particular, so loose runs scope to `body` — which still
 * exercises the whole selector path, just without narrowing.
 */
const SELECTOR = args[2] ?? process.env.SMOKE_SELECTOR ?? (process.argv.includes('--loose') ? 'body' : '.pricing');

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

  /* --- the extension is downloadable ------------------------------------- *
   * It is served from the extension/ directory, which has to be copied into
   * the runtime image explicitly. Miss that and the download button hands back
   * a 404 while every other check still passes.                              */
  console.log('\nextension');
  const ext = await fetch(`${BASE}/api/extension`);
  const extBytes = (await ext.arrayBuffer()).byteLength;
  check(
    `extension downloads (${Math.round(extBytes / 1024)}KB)`,
    ext.status === 200 &&
      (ext.headers.get('content-type') ?? '').includes('zip') &&
      extBytes > 5_000,
    `status ${ext.status}, ${extBytes} bytes`,
  );

  /* --- the console snippet is served ------------------------------------- */
  const snippet = await fetch(`${BASE}/api/harvest-script`);
  const snippetText = await snippet.text();
  check(
    `harvest snippet served (${Math.round(snippetText.length / 1024)}KB)`,
    snippet.status === 200 && snippetText.includes('/api/import'),
    `status ${snippet.status}, ${snippetText.length} chars`,
  );


  /* --- the MCP surface an agent connects to ------------------------------ */
  console.log('\nMCP');

  const rpc = async (method, params) => {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  };

  const handshake = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1' },
  });
  check(
    'MCP initialize answers with a protocol version',
    handshake.body?.result?.protocolVersion === '2025-06-18' &&
      handshake.body?.result?.serverInfo?.name === 'designdna',
    JSON.stringify(handshake.body).slice(0, 160),
  );

  const listed = await rpc('tools/list');
  const toolNames = (listed.body?.result?.tools ?? []).map((t) => t.name);
  check(
    `MCP exposes ${toolNames.length} tools`,
    ['extract_page', 'extract_component', 'list_components', 'get_component', 'request_browser_capture'].every(
      (name) => toolNames.includes(name),
    ),
    toolNames.join(', '),
  );

  const components = await rpc('tools/call', {
    name: 'list_components',
    arguments: { extraction_id: jobId },
  });
  const componentText = components.body?.result?.content?.[0]?.text ?? '';
  const firstComponent = componentText.match(/- (section-\d+-[a-z-]+)/)?.[1];
  check(
    `list_components names the sections (${firstComponent ?? 'none'})`,
    Boolean(firstComponent),
    componentText.slice(0, 200),
  );

  const code = await rpc('tools/call', {
    name: 'get_component',
    arguments: { extraction_id: jobId, component_id: firstComponent, format: 'react' },
  });
  const codeText = code.body?.result?.content?.[0]?.text ?? '';
  check(
    'get_component returns compilable-looking React for one component',
    codeText.includes('export function') && codeText.includes('.tsx'),
    codeText.slice(0, 200),
  );

  /* --- a component extraction, rendered for real ------------------------- */
  const componentRun = await rpc('tools/call', {
    name: 'extract_component',
    arguments: {
      url: TARGET,
      selector: SELECTOR,
      viewports: ['desktop'],
      wait_seconds: 200,
    },
  });
  const componentRunText = componentRun.body?.result?.content?.[0]?.text ?? '';
  check(
    `extract_component measures one element (${SELECTOR})`,
    !componentRun.body?.result?.isError && /Extracted one component/.test(componentRunText),
    componentRunText.slice(0, 240),
  );

  const missing = await rpc('tools/call', {
    name: 'extract_component',
    arguments: { url: TARGET, selector: '.no-such-element-anywhere', wait_seconds: 200 },
  });
  const missingText = missing.body?.result?.content?.[0]?.text ?? '';
  check(
    'a selector that matches nothing fails loudly',
    missing.body?.result?.isError === true && /No element matches/.test(missingText),
    missingText.slice(0, 200),
  );

  /* --- the capture queue the extension polls ----------------------------- */
  const queued = await rpc('tools/call', {
    name: 'request_browser_capture',
    arguments: { url: 'https://example.com/', selector: '.pricing', note: 'smoke check' },
  });
  const queuedText = queued.body?.result?.content?.[0]?.text ?? '';
  const requestJob = queuedText.match(/extraction_id: (\S+)/)?.[1];
  check('request_browser_capture queues a capture', Boolean(requestJob), queuedText.slice(0, 200));

  const pending = await fetch(`${BASE}/api/extension/requests`).then((r) => r.json());
  const queuedRequest = (pending.requests ?? []).find((r) => r.selector === '.pricing');
  check(
    'the extension sees it pending',
    Boolean(queuedRequest),
    JSON.stringify(pending).slice(0, 200),
  );

  if (queuedRequest) {
    const declined = await fetch(`${BASE}/api/extension/requests/${queuedRequest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline', message: 'smoke check' }),
    }).then((r) => r.json());

    const after = await fetch(`${BASE}/api/extract/${requestJob}`).then((r) => r.json());
    check(
      'declining fails the extraction the agent is polling',
      declined.status === 'declined' && after.status === 'error',
      `${JSON.stringify(declined)} / ${JSON.stringify(after).slice(0, 120)}`,
    );
  }

  /* --- the connect page -------------------------------------------------- */
  const connect = await fetch(`${BASE}/connect`);
  const connectHtml = await connect.text();
  check(
    'GET /connect documents the endpoint',
    connect.status === 200 && connectHtml.includes('/api/mcp'),
    `status ${connect.status}`,
  );

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
