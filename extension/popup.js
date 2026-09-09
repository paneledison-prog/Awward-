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

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'extract',
      tabId: tab.id,
      instance,
      shotMode,
    });

    if (!result?.ok) throw new Error(result?.error ?? 'Extraction failed');

    say('Done — opening results.', 'ok');
    await chrome.tabs.create({ url: result.url });
    window.close();
  } catch (error) {
    say(String(error.message ?? error), 'err');
  } finally {
    $('go').disabled = false;
  }
});

// The worker reports progress as it scrolls and stitches, which otherwise looks
// like a hang on a long page.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'progress') say(msg.text);
});
