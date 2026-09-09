import { getFinishedJob } from '@/lib/jobs';
import { buildZip } from '@/lib/emit/bundle';

export const runtime = 'nodejs';

function safeFilename(input: string): string {
  try {
    return new URL(input).hostname.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    return 'extraction';
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await getFinishedJob(id);

  if (!job?.result) {
    return new Response('Extraction not found or not finished.', { status: 404 });
  }

  const zip = await buildZip(job.result);
  const name = `designdna-${safeFilename(job.result.page.finalUrl)}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(zip.length),
    },
  });
}
