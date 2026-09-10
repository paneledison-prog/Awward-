import { NextResponse } from 'next/server';
import { failJob } from '@/lib/jobs';
import { CORS } from '@/lib/cors';
import { getRequest, updateRequest } from '@/lib/requests';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * The person's answer to one request: `claim` when they start the capture,
 * `decline` when they will not do it.
 *
 * Declining fails the agent's job rather than leaving it to time out, so the
 * agent is told what happened instead of polling a request that will never
 * complete.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: { action?: string; message?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is fine for claim.
  }

  const existing = await getRequest(id);
  if (!existing) {
    return NextResponse.json({ error: 'Unknown capture request.' }, { status: 404, headers: CORS });
  }

  if (body.action === 'decline') {
    const message = body.message?.slice(0, 200) || 'The person declined this capture.';
    await updateRequest(id, { status: 'declined', message });
    failJob(existing.jobId, message);
    return NextResponse.json({ status: 'declined' }, { headers: CORS });
  }

  if (existing.status !== 'pending' && existing.status !== 'claimed') {
    return NextResponse.json(
      { error: `That capture is already ${existing.status}.` },
      { status: 409, headers: CORS },
    );
  }

  await updateRequest(id, { status: 'claimed' });
  return NextResponse.json({ status: 'claimed', jobId: existing.jobId }, { headers: CORS });
}
