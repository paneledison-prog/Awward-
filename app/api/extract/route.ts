import { NextResponse } from 'next/server';
import { createJob, emitProgress, failJob, finishJob } from '@/lib/jobs';
import { runExtraction } from '@/lib/extract';
import { normalizeUrl } from '@/lib/resolve';
import type { ContentMode, ExtractOptions, ViewportLabel } from '@/lib/types';

export const runtime = 'nodejs';
// Rendering three viewports plus a dark-mode pass runs well past the default.
export const maxDuration = 300;

const VALID_VIEWPORTS: ViewportLabel[] = ['desktop', 'tablet', 'mobile'];

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const rawUrl = typeof body.url === 'string' ? body.url : '';
  if (!rawUrl.trim()) {
    return NextResponse.json({ error: 'A url is required.' }, { status: 400 });
  }

  let url: string;
  try {
    url = normalizeUrl(rawUrl);
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    return NextResponse.json({ error: `"${rawUrl}" is not a valid http(s) URL.` }, { status: 400 });
  }

  const requested = Array.isArray(body.viewports) ? (body.viewports as string[]) : [];
  const viewports = VALID_VIEWPORTS.filter((v) => requested.includes(v));

  const options: ExtractOptions = {
    url,
    contentMode: (body.contentMode === 'placeholder' ? 'placeholder' : 'verbatim') as ContentMode,
    viewports: viewports.length ? viewports : ['desktop', 'tablet', 'mobile'],
    emitReact: body.emitReact !== false,
    emitHtml: body.emitHtml !== false,
  };

  const job = createJob(options);

  // Deliberately not awaited: the client follows progress over SSE, and holding
  // the request open for a minute would hit every intermediate proxy timeout.
  void runExtraction(job.id, options, (step, message, progress) =>
    emitProgress(job.id, step, message, progress),
  )
    .then((result) => finishJob(job.id, result))
    .catch((error: unknown) => {
      failJob(job.id, error instanceof Error ? error.message : String(error));
    });

  return NextResponse.json({ jobId: job.id, url }, { status: 202 });
}
