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
async function harvestPage(tabId, selector) {
  // harvest.js is injected as a file, which cannot take arguments, so the
  // selector is planted on the page first and the file reads it once.
  if (selector) {
    await run(tabId, [selector], (value) => {
      globalThis.__designdna_root = value;
    });
  }

  const [entry] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: ['harvest.js'],
  });
  if (!entry?.result?.harvest) throw new Error('The page returned no measurements.');
  const root = entry.result.harvest.root;
  if (selector && root && !root.found) {
    throw new Error(`Nothing on this page matches "${selector}".`);
  }
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

async function extract({ tabId, instance, shotMode, selector, requestId, onProgress }) {
  progress = onProgress ?? (() => {});
  progress(selector ? `Measuring ${selector}…` : 'Measuring the page…');
  const { harvest, network } = await harvestPage(tabId, selector);

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
      requestId,
      screenshots: screenshot ? { [harvest.viewport.label]: screenshot } : undefined,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.url;
}


/* ------------------------------------------------------------------ */
/* Captures an agent has asked for                                     */
/* ------------------------------------------------------------------ */

const POLL_ALARM = 'designdna-poll';

async function instanceUrl() {
  const { instance = '' } = await chrome.storage.sync.get('instance');
  return instance.replace(/\/$/, '');
}

/** Pending requests, or an empty list whenever the instance is unreachable. */
async function fetchRequests() {
  const instance = await instanceUrl();
  if (!instance) return [];

  try {
    const res = await fetch(`${instance}/api/extension/requests`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.requests) ? data.requests : [];
  } catch {
    // The instance sleeps when idle; a failed poll is normal, not an error.
    return [];
  }
}

/** The badge is the whole notification: a count, never an action. */
async function refreshBadge() {
  const requests = await fetchRequests();
  await chrome.action.setBadgeText({ text: requests.length ? String(requests.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  return requests;
}

async function answerRequest(id, action, message) {
  const instance = await instanceUrl();
  if (!instance) throw new Error('No DesignDNA instance is configured.');

  const res = await fetch(`${instance}/api/extension/requests/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Could not update the request (${res.status})`);
  return data;
}

/** Open the page in its own tab and wait for it to finish loading. */
function openTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (!tab?.id) return reject(new Error('Could not open that page.'));

      const done = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(done);
        resolve(tab.id);
      };
      chrome.tabs.onUpdated.addListener(done);

      // A page that never reports complete should not hang the capture; the
      // harvest reads whatever has rendered by then.
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(done);
        resolve(tab.id);
      }, 20000);
    });
  });
}

/**
 * Perform one queued capture, after the person clicked Capture.
 *
 * Host permission for the target origin is requested at that click — the
 * extension never holds standing access to every site.
 */
async function fulfill({ request, shotMode, onProgress }) {
  progress = onProgress ?? (() => {});
  const instance = await instanceUrl();

  progress('Waiting for the page to load…');
  const tabId = await openTab(request.url);
  await answerRequest(request.id, 'claim');

  // Let the page settle: a harvest of a half-rendered page measures a
  // half-rendered page, confidently.
  await sleep(2500);

  const url = await extract({
    tabId,
    instance,
    shotMode,
    selector: request.selector || undefined,
    requestId: request.id,
    onProgress,
  });

  await refreshBadge();
  return url;
}

chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => void refreshBadge());
chrome.runtime.onInstalled.addListener(() => void refreshBadge());

// Exposed so the extraction can be driven directly in tests. A service worker
// cannot receive its own runtime messages, so there is otherwise no way to
// exercise this path without simulating a popup click.
self.designdna = { extract, captureFullPage, captureViewport, fetchRequests, fulfill };

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
    try {
      if (message?.type === 'extract') {
        const url = await extract({
          ...message,
          onProgress: (text) => send({ type: 'progress', text }),
        });
        send({ type: 'done', url });
        return;
      }

      if (message?.type === 'requests') {
        send({ type: 'requests', requests: await refreshBadge() });
        return;
      }

      if (message?.type === 'fulfill') {
        const url = await fulfill({
          request: message.request,
          shotMode: message.shotMode,
          onProgress: (text) => send({ type: 'progress', text }),
        });
        send({ type: 'done', url });
        return;
      }

      if (message?.type === 'decline') {
        await answerRequest(message.id, 'decline', message.message);
        send({ type: 'requests', requests: await refreshBadge() });
      }
    } catch (error) {
      send({ type: 'error', error: String(error.message ?? error) });
    }
  });
});
