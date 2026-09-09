import { NextResponse } from 'next/server';
import { looksLikeUrl, normalizeUrl, resolveInput } from '@/lib/resolve';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let input = '';
  try {
    const body = (await request.json()) as { input?: unknown };
    input = typeof body.input === 'string' ? body.input : '';
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with an "input" field.' }, { status: 400 });
  }

  if (!input.trim()) {
    return NextResponse.json({ error: 'Enter a website name or URL.' }, { status: 400 });
  }

  if (looksLikeUrl(input)) {
    try {
      return NextResponse.json({ direct: normalizeUrl(input), candidates: [] });
    } catch {
      return NextResponse.json({ error: `"${input}" is not a valid URL.` }, { status: 400 });
    }
  }

  const outcome = await resolveInput(input);
  if (outcome.candidates.length === 0) {
    return NextResponse.json(
      {
        candidates: [],
        error: `No site found for "${input}". Try the full URL instead.`,
      },
      { status: 404 },
    );
  }
  return NextResponse.json(outcome);
}
