/**
 * Client-side error relay for the embedded reader (see
 * document/MyReader_Embedded_WebApp.md). A book opened via
 * pages/readerx/open.tsx runs entirely in the browser — its errors never
 * touch this server process, so they never show up in `docker logs`. This
 * route just console.error()s whatever it's given so an embedded-open
 * failure lands in the same log stream as the rest of MyReader's server
 * output. Only called from the embedded flow (see embedClientLog.ts) — every
 * other app form never hits this route.
 */
import { NextRequest, NextResponse } from 'next/server';

const MAX_MESSAGE_LENGTH = 2000;

interface ClientLogBody {
  bookHash?: string;
  message?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: ClientLogBody;
  try {
    body = (await request.json()) as ClientLogBody;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (!body.message) {
    return new NextResponse(null, { status: 400 });
  }

  const message = body.message.slice(0, MAX_MESSAGE_LENGTH);
  console.error('[embed-client]', body.bookHash ?? '(unknown book)', message);

  return new NextResponse(null, { status: 204 });
}
