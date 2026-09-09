import { NextResponse } from 'next/server';
import { getFinishedJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = await getFinishedJob(id);

  if (!job) {
    return NextResponse.json(
      { error: 'That extraction is no longer available. Extractions expire after a while.' },
      { status: 404 },
    );
  }

  if (job.status === 'error') {
    return NextResponse.json({ status: 'error', error: job.error }, { status: 200 });
  }
  if (job.status !== 'done' || !job.result) {
    return NextResponse.json({ status: job.status, events: job.events }, { status: 200 });
  }

  return NextResponse.json({ status: 'done', result: job.result });
}
