/* Popup: collects settings, asks the worker to do the work, reports progress. */

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

let tab;
let resultUrl = '';
let port;

/**
 * One long-lived port for the whole popup session, rather than sendMessage.
 *
 * A capture runs for tens of seconds and a popup closes the moment it loses
 * focus. A listener that answers that late logs "the message channel closed
 * before a response was received" for every message in flight — noise that
 * looks like a failure. A port reports its own disconnect, so the worker
 * carries on and posts nothing into a channel that has gone.
 */
function worker() {
  if (port) return port;

  port = chrome.runtime.connect({ name: 'designdna' });
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'progress') return say(msg.text);
    if (msg.type === 'requests') return renderRequests(msg.requests);

    if (msg.type === 'done') {
      resultUrl = msg.url;
      summarize($('shot').value, $('instance').value.trim());
      $('setup').hidden = true;
      $('requests').hidden = true;
      $('done').hidden = false;
      return;
    }

    if (msg.type === 'error') {
      say(msg.error, 'err');
      $('go').disabled = false;
    }
  });

  port.onDisconnect.addListener(() => {
    port = undefined;
    $('go').disabled = false;
  });

  return port;
}

/**
 * Render what an agent has queued.
 *
 * These are requests, not instructions: nothing opens a tab or reads a page
 * until Capture is clicked here.
 */
function renderRequests(requests) {
  const list = $('requestList');
  list.textContent = '';
  $('requests').hidden = !requests?.length;
  if (!requests?.length) return;

  for (const request of requests) {
    const card = document.createElement('div');
    card.className = 'request';

    const url = document.createElement('div');
    url.className = 'request-url';
    url.textContent = request.url;
    card.append(url);

    if (request.selector) {
      const selector = document.createElement('div');
      selector.className = 'request-selector';
      selector.textContent = request.selector;
      card.append(selector);
    }

    if (request.note) {
      const note = document.createElement('p');
      note.className = 'request-note';
      note.textContent = request.note;
      card.append(note);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const capture = document.createElement('button');
    capture.className = 'primary';
    capture.textContent = 'Capture';
    capture.addEventListener('click', () => startCapture(request, capture));

    const dismiss = document.createElement('button');
    dismiss.className = 'secondary';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      worker().postMessage({ type: 'decline', id: request.id });
    });

    actions.append(capture, dismiss);
    card.append(actions);
    list.append(card);
  }
}

/** Host permission for that one origin is asked for at the click, not up front. */
async function startCapture(request, button) {
  button.disabled = true;
  try {
    const origin = new URL(request.url).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      button.disabled = false;
      return say(`Permission for ${new URL(request.url).host} was declined.`, 'err');
    }
  } catch {
    button.disabled = false;
    return say('That request has an unusable URL.', 'err');
  }

  say('Opening the page…');
  worker().postMessage({ type: 'fulfill', request, shotMode: $('shot').value });
}

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

for (const id of ['version', 'versionDone']) {
  $(id).textContent = `v${chrome.runtime.getManifest().version}`;
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  showSite(tab);

  const { instance = '' } = await chrome.storage.sync.get('instance');
  $('instance').value = instance;

  const { shotMode = 'full' } = await chrome.storage.sync.get('shotMode');
  $('shot').value = shotMode;

  if (instance) worker().postMessage({ type: 'requests' });
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

  worker().postMessage({ type: 'extract', tabId: tab.id, instance, shotMode });
});
