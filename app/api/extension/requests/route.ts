import { NextResponse } from 'next/server';
import { CORS } from '@/lib/cors';
import { listRequests } from '@/lib/requests';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** What the extension polls every 30 seconds while an instance is configured. */
export async function GET() {
  const pending = await listRequests('pending');

  return NextResponse.json(
    {
      requests: pending.map((request) => ({
        id: request.id,
        url: request.url,
        selector: request.selector ?? '',
        note: request.note ?? '',
        createdAt: request.createdAt,
      })),
    },
    { headers: { ...CORS, 'Cache-Control': 'no-store' } },
  );
}
