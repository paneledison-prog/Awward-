import { getJob, subscribe } from '@/lib/jobs';

export const runtime = 'nodejs';

/**
 * Server-sent events for a running extraction.
 *
 * Extraction takes 30-60 seconds across several renders. Without streamed
 * progress the UI is a blank spinner for a minute, which reads as a hang.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getJob(id)) {
    return new Response('Unknown job', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = subscribe(id, (payload) => {
        if ('done' in payload) {
          send('end', { id });
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed by the client disconnecting */
          }
          return;
        }
        send('progress', payload);
      });

      // Proxies drop idle connections; a comment frame keeps this one alive
      // through the long gap while a page renders.
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 15_000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
