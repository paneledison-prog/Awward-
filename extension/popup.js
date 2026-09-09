/* Popup: collects settings, asks the worker to do the work, reports progress. */

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

let tab;
let resultUrl = '';

function showSite(t) {
  let host = '';
  try {
    host = new URL(t?.url ?? '').host;
  } catch {
    host = '';
  }
  $('siteName').textContent = t?.title?.trim() || host || 'This page';
  $('siteHost').textContent = host || '(no page)';
  $('siteUrl').hidden = !host;

  // The page's own favicon in the mark tile, when the browser has one; the
  // asterisk stays as the fallback so the tile is never an empty square.
  if (t?.favIconUrl) {
    const img = document.createElement('img');
    img.src = t.favIconUrl;
    img.width = 22;
    img.height = 22;
    img.alt = '';
    img.style.borderRadius = '5px';
    img.onload = () => {
      $('mark').textContent = '';
      $('mark').append(img);
    };
  }
}

/** Hugeicons Tick02 (stroke rounded) as an inline SVG node. */
function tickIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M5 14L8.5 17.5L19 6.5');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** What the run actually did — every line is a fact this popup observed. */
function summarize(shotMode, instance) {
  const shots = {
    full: 'Full-page screenshot stitched',
    viewport: 'Visible area captured',
    none: 'Screenshots skipped',
  };
  let instanceHost = instance;
  try {
    instanceHost = new URL(instance).host;
  } catch {
    /* Shown verbatim if it will not parse. */
  }

  const lines = [
    `Design measured on ${$('siteHost').textContent}`,
    shots[shotMode] ?? shots.full,
    `Analyzed by ${instanceHost}`,
    'Code bundle ready to download',
  ];

  const list = $('summary');
  list.textContent = '';
  for (const text of lines) {
    const li = document.createElement('li');
    const tick = document.createElement('span');
    tick.className = 'tick';
    // Hugeicons Tick02, drawn rather than typed: a text checkmark renders at
    // whatever weight and baseline the system font gives it.
    tick.append(tickIcon());
    li.append(tick, document.createTextNode(text));
    list.append(li);
  }
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  showSite(tab);

  const { instance = '' } = await chrome.storage.sync.get('instance');
  $('instance').value = instance;

  const { shotMode = 'full' } = await chrome.storage.sync.get('shotMode');
  $('shot').value = shotMode;
})();

$('explore').addEventListener('click', async () => {
  if (resultUrl) await chrome.tabs.create({ url: resultUrl });
  window.close();
});

$('close').addEventListener('click', () => window.close());

$('go').addEventListener('click', async () => {
  const instance = $('instance').value.trim().replace(/\/$/, '');
  const shotMode = $('shot').value;

  if (!instance) return say('Enter your DesignDNA instance URL first.', 'err');
  if (!tab?.id) return say('No active tab.', 'err');
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url ?? '')) {
    return say('Browser-internal pages cannot be measured.', 'err');
  }

  await chrome.storage.sync.set({ instance, shotMode });

  // Host permission is requested for the configured instance only, at the point
  // it is actually needed, rather than demanded up front for every site.
  try {
    const origin = new URL(instance).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return say('Permission for that instance was declined.', 'err');
  } catch {
    return say('That instance URL is not valid.', 'err');
  }

  $('go').disabled = true;
  say('Measuring…');

  // A port, not sendMessage: this runs for tens of seconds and the popup closes
  // as soon as it loses focus. The port simply disconnects, and the worker
  // carries on rather than logging a channel error for every progress update.
  const port = chrome.runtime.connect({ name: 'designdna' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'progress') return say(msg.text);

    if (msg.type === 'done') {
      // The results tab is opened by Explore, not automatically: the summary is
      // the only place the popup can report what it did before it closes.
      resultUrl = msg.url;
      summarize(shotMode, instance);
      $('setup').hidden = true;
      $('done').hidden = false;
      return;
    }

    if (msg.type === 'error') {
      say(msg.error, 'err');
      $('go').disabled = false;
    }
  });

  port.onDisconnect.addListener(() => {
    $('go').disabled = false;
  });

  port.postMessage({ type: 'extract', tabId: tab.id, instance, shotMode });
});
