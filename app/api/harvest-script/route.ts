import { inPageHarvest } from '@/lib/extract/harvest';
import { requestOrigin } from '@/lib/request-origin';

export const runtime = 'nodejs';

/**
 * The harvest, as a script to run in your own browser.
 *
 * Some sites will not serve an automated browser at all — a bot check appears
 * instead of the page, and no amount of rendering here will change that. But
 * the person asking can already view the site perfectly well. This hands them
 * the same DOM walk the server would have run, to execute in the tab they
 * already have open.
 *
 * The function is serialized from the real implementation rather than copied,
 * so the two can never drift apart.
 */
export async function GET(request: Request) {
  const base = requestOrigin(request);

  const script = `/* DesignDNA — run this in the DevTools console on the page you want to extract. */
(async () => {
  const MAX_NODES = 3000;
  const harvestFn = ${inPageHarvest.toString()};

  console.log('%cDesignDNA%c harvesting…', 'font-weight:bold;color:#34d399', '');
  const raw = harvestFn(MAX_NODES);

  const w = window.innerWidth;
  const label = w >= 1200 ? 'desktop' : w >= 700 ? 'tablet' : 'mobile';

  const harvest = {
    requestedUrl: location.href,
    ...raw,
    viewport: { width: w, height: window.innerHeight, label },
  };

  // Resource timings stand in for the network log the server records; this is
  // what identifies where the fonts came from.
  const network = performance.getEntriesByType('resource').slice(0, 400).map((e) => ({
    url: e.name,
    type: e.initiatorType || '',
    status: 200,
  }));

  console.log('%cDesignDNA%c ' + harvest.nodes.length + ' elements, uploading…',
    'font-weight:bold;color:#34d399', '');

  try {
    const res = await fetch('${base}/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harvest, network }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    console.log('%cDesignDNA%c done → ' + data.url, 'font-weight:bold;color:#34d399', '');
    window.open(data.url, '_blank');
  } catch (err) {
    console.error('DesignDNA upload failed:', err);
    console.log('Copy the harvest manually and paste it into DesignDNA:');
    try { copy(JSON.stringify({ harvest, network })); console.log('(copied to clipboard)'); }
    catch (_) { console.log(JSON.stringify({ harvest, network })); }
  }
})();
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
