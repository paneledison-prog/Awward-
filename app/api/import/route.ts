import { NextResponse } from 'next/server';
import { createJob, emitProgress, failJob, finishJob } from '@/lib/jobs';
import { analyze } from '@/lib/extract';
import { requestOrigin } from '@/lib/request-origin';
import { screenshotName, screenshotUrl, writeScreenshot } from '@/lib/screenshots';
import type {
  AssetManifest,
  HarvestNetworkEntry,
  HarvestResult,
  ViewportLabel,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** A harvest of a large page runs to several megabytes. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/** A stitched full-page capture of a long page, with headroom. */
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

const VIEWPORT_LABELS: ViewportLabel[] = ['desktop', 'tablet', 'mobile'];

/**
 * Accept a harvest gathered in someone else's browser.
 *
 * CORS is open because that is the entire point: the script runs on whatever
 * origin the person is looking at and posts here. The endpoint takes data and
 * returns an id — no credentials are read, and nothing it returns is sensitive.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Enough of a shape check to fail clearly rather than deep in inference. */
function validate(harvest: unknown): string | null {
  if (!harvest || typeof harvest !== 'object') return 'harvest must be an object';
  const h = harvest as Partial<HarvestResult>;
  if (!Array.isArray(h.nodes)) return 'harvest.nodes must be an array';
  if (h.nodes.length === 0) return 'harvest.nodes is empty — the page had nothing visible to measure';
  if (!h.viewport || typeof h.viewport.width !== 'number') return 'harvest.viewport.width is required';
  if (typeof h.finalUrl !== 'string') return 'harvest.finalUrl is required';
  // The body is untrusted JSON, so this is a genuine unknown, not a HarvestNode.
  const first = h.nodes[0] as unknown as Record<string, unknown> | undefined;
  if (!first || typeof first.styles !== 'object') {
    return 'harvest.nodes[0].styles is missing — this does not look like a DesignDNA harvest';
  }
  return null;
}

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Harvest too large (${Math.round(length / 1e6)}MB). The cap is 32MB.` },
      { status: 413, headers: CORS },
    );
  }

  let body: {
    harvest?: unknown;
    network?: unknown;
    contentMode?: unknown;
    screenshots?: Record<string, string>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400, headers: CORS });
  }

  const invalid = validate(body.harvest);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400, headers: CORS });
  }

  const harvest = body.harvest as HarvestResult;
  const network = (Array.isArray(body.network) ? body.network : []) as HarvestNetworkEntry[];
  const label: ViewportLabel = harvest.viewport.label ?? 'desktop';

  const job = createJob({
    url: harvest.finalUrl,
    contentMode: body.contentMode === 'placeholder' ? 'placeholder' : 'verbatim',
    viewports: [label],
    emitReact: true,
    emitHtml: true,
  });

  const startedAt = Date.now();

  // Screenshots arrive as data URLs from the extension. Decoding them here
  // keeps them on the same disk the server-rendered captures use, so the UI,
  // the bundle and the agent brief all reference them identically.
  const screenshots: AssetManifest['screenshots'] = {};
  const shotWarnings: string[] = [];
  for (const [viewport, dataUrl] of Object.entries(body.screenshots ?? {})) {
    // The route that serves these only accepts the three known viewport names;
    // anything else would be written and then be permanently unreadable.
    if (!VIEWPORT_LABELS.includes(viewport as ViewportLabel)) {
      shotWarnings.push(`Screenshot key "${viewport}" is not a known viewport and was skipped.`);
      continue;
    }
    const match = /^data:image\/(jpeg|png|webp);base64,([\s\S]+)$/.exec(dataUrl ?? '');
    if (!match) {
      shotWarnings.push(`Screenshot for ${viewport} was not a supported data URL and was skipped.`);
      continue;
    }
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      shotWarnings.push(
        `Screenshot for ${viewport} was ${Math.round(buffer.byteLength / 1e6)}MB and was skipped.`,
      );
      continue;
    }
    const name = screenshotName(job.id, viewport);
    await writeScreenshot(name, buffer);
    screenshots[viewport as ViewportLabel] = screenshotUrl(name);
  }

  const warnings = [
    `Harvested in your browser at ${harvest.viewport.width}px, so only the ${label} layout was measured — responsive behavior across other viewports is not included.`,
    ...(Object.keys(screenshots).length === 0
      ? ['No screenshot was captured. The browser extension can capture one; the console snippet cannot.']
      : []),
    ...shotWarnings,
  ];

  void analyze({
    jobId: job.id,
    requestedUrl: harvest.requestedUrl || harvest.finalUrl,
    primary: harvest,
    others: [],
    network,
    screenshots,
    contentMode: job.options.contentMode,
    emitReact: true,
    emitHtml: true,
    warnings,
    startedAt,
    onProgress: (step, message, progress) => emitProgress(job.id, step, message, progress),
  })
    .then((result) => finishJob(job.id, result))
    .catch((error: unknown) => {
      failJob(job.id, error instanceof Error ? error.message : String(error));
    });

  const origin = requestOrigin(request);
  return NextResponse.json(
    { jobId: job.id, url: `${origin}/?job=${job.id}` },
    { status: 202, headers: CORS },
  );
}
