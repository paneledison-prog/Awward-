import { readScreenshot } from '@/lib/screenshots';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const data = await readScreenshot(file);

  if (!data) {
    return new Response('Screenshot not found.', { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(data.length),
      // Names include the job id, so a given URL's bytes never change.
      'Cache-Control': 'public, max-age=3600, immutable',
    },
  });
}
