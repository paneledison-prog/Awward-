/* Popup: collects settings, asks the worker to do the work, reports progress. */

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(text, kind = '') {
  status.textContent = text;
  status.className = kind;
}

let tab;

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('pageUrl').textContent = tab?.url ?? '(no page)';

  const { instance = '' } = await chrome.storage.sync.get('instance');
  $('instance').value = instance;

  const { shotMode = 'full' } = await chrome.storage.sync.get('shotMode');
  $('shot').value = shotMode;
})();

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

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'progress') return say(msg.text);

    if (msg.type === 'done') {
      say('Done — opening results.', 'ok');
      await chrome.tabs.create({ url: msg.url });
      window.close();
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
