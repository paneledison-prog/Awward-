/* Service worker: runs the harvest, captures screenshots, uploads the result. */

/** captureVisibleTab is rate-limited to about two calls a second. */
const CAPTURE_INTERVAL_MS = 550;
/** Enough for a very long marketing page without capturing forever. */
const MAX_SEGMENTS = 24;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set for the duration of one extraction; reports to that popup only. */
let progress = () => {};

async function run(tabId, args, func) {
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args,
    func,
  });
  return entry?.result;
}

/** Harvest, from the generated file so it matches the server's implementation. */
async function harvestPage(tabId) {
  const [entry] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['harvest.js'],
  });
  if (!entry?.result?.harvest) throw new Error('The page returned no measurements.');
  return entry.result;
}

async function captureViewport() {
  return chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 80 });
}

/**
 * Full-page capture by scrolling and stitching.
 *
 * Chrome has no full-page screenshot API for extensions: captureVisibleTab does
 * exactly what its name says. So the page is scrolled a viewport at a time and
 * the frames are composited here.
 */
async function captureFullPage(tabId) {
  const originalY = await run(tabId, [], () => window.scrollY);

  // Pin anything that would otherwise follow the scroll and repeat in every
  // frame. Each replacement is chosen to preserve layout: `fixed` and
  // `absolute` are both out of flow, and `sticky` and `relative` are both in
  // it. A blunter rule — forcing header and nav to absolute — pulls a sticky
  // header out of flow, shifts the whole page up by its height, and every seam
  // after the first lands in the wrong place.
  await run(tabId, [], () => {
    const undo = [];
    for (const el of document.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      undo.push([el, el.style.position]);
      el.style.position = pos === 'fixed' ? 'absolute' : 'relative';
    }
    window.__designdnaUndo = undo;

    const style = document.createElement('style');
    style.id = '__designdna_capture';
    style.textContent = '*{animation:none!important;transition:none!important}';
    document.head.appendChild(style);
  });

  // Measured after the change, so the height reflects what is actually captured.
  const metrics = await run(tabId, [], () => ({
    total: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    vh: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }));
  metrics.originalY = originalY;

  // Calibrate against a real frame rather than trusting window.innerHeight.
  // captureVisibleTab returns the browser's content area, which is routinely
  // shorter than the layout viewport. Scrolling by innerHeight while each frame
  // covers less leaves an uncaptured strip at every seam.
  await run(tabId, [], () => window.scrollTo(0, 0));
  await sleep(CAPTURE_INTERVAL_MS);
  const firstUrl = await captureViewport();
  const firstBitmap = await createImageBitmap(await (await fetch(firstUrl)).blob());
  const imageHeight = firstBitmap.height;
  firstBitmap.close();

  // CSS pixels each capture actually covers, and the image-per-CSS-pixel ratio.
  const step = imageHeight / metrics.dpr;
  metrics.scale = metrics.dpr;
  metrics.step = step;

  const wanted = Math.min(Math.ceil(metrics.total / step), MAX_SEGMENTS);

  const frames = [{ dataUrl: firstUrl, y: 0 }];
  for (let i = 1; i < wanted; i++) {
    const y = await run(tabId, [i * step], (top) => {
      window.scrollTo(0, top);
      return window.scrollY;
    });

    // Reaching the bottom early means every further frame is identical.
    if (y === frames[frames.length - 1].y) break;

    await sleep(CAPTURE_INTERVAL_MS);
    progress(`Capturing ${i + 1}/${wanted}…`);
    frames.push({ dataUrl: await captureViewport(), y });
  }

  await run(tabId, [metrics.originalY], (y) => {
    for (const [el, previous] of window.__designdnaUndo ?? []) el.style.position = previous;
    delete window.__designdnaUndo;
    document.getElementById('__designdna_capture')?.remove();
    window.scrollTo(0, y);
  });

  return stitch(frames, metrics);
}

async function stitch(frames, metrics) {
  const bitmaps = await Promise.all(
    frames.map(async (f) => createImageBitmap(await (await fetch(f.dataUrl)).blob())),
  );

  const width = bitmaps[0].width;
  const scale = metrics.scale;
  const lastY = frames[frames.length - 1].y;
  const heightCss = Math.min(lastY + metrics.step, metrics.total);

  const canvas = new OffscreenCanvas(width, Math.round(heightCss * scale));
  const ctx = canvas.getContext('2d');

  bitmaps.forEach((bitmap, i) => {
    ctx.drawImage(bitmap, 0, Math.round(frames[i].y * scale));
    bitmap.close();
  });

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function extract({ tabId, instance, shotMode, onProgress }) {
  progress = onProgress ?? (() => {});
  progress('Measuring the page…');
  const { harvest, network } = await harvestPage(tabId);

  let screenshot;
  if (shotMode === 'viewport') {
    progress('Capturing the visible area…');
    screenshot = await captureViewport();
  } else if (shotMode === 'full') {
    screenshot = await captureFullPage(tabId);
  }

  progress(`Uploading ${harvest.nodes.length} elements…`);
  const res = await fetch(`${instance}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      harvest,
      network,
      screenshots: screenshot ? { [harvest.viewport.label]: screenshot } : undefined,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}

// Exposed so the extraction can be driven directly in tests. A service worker
// cannot receive its own runtime messages, so there is otherwise no way to
// exercise this path without simulating a popup click.
self.designdna = { extract, captureFullPage, captureViewport };

/**
 * A long-lived port rather than sendMessage/sendResponse.
 *
 * An extraction runs for tens of seconds and a popup closes the moment it loses
 * focus. A listener that returns `true` and answers that late logs "the message
 * channel closed before a response was received" for every message in flight —
 * noise that looks like a failure and buries the real error when there is one.
 * A port reports its own disconnect, so work continues and nothing is posted
 * into a channel that has gone.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'designdna') return;

  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
  });

  const send = (message) => {
    if (!connected) return;
    try {
      port.postMessage(message);
    } catch {
      connected = false;
    }
  };

  port.onMessage.addListener(async (message) => {
    if (message?.type !== 'extract') return;
    try {
      const url = await extract({
        ...message,
        onProgress: (text) => send({ type: 'progress', text }),
      });
      send({ type: 'done', url });
    } catch (error) {
      send({ type: 'error', error: String(error.message ?? error) });
    }
  });
});
