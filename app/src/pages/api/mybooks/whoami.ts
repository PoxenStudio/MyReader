import type { NextApiRequest, NextApiResponse } from 'next';

interface WhoamiResponse {
  userId?: number;
  username?: string;
  canRead?: boolean;
  isActive?: boolean;
}

/**
 * Server-to-server bridge for the embedded reader entry point
 * (pages/readerx/open.tsx): forwards the browser's MyBooks session
 * cookie to MyBooks' `GET /api/user/whoami` and relays the identity back.
 * Runs on the Next.js server so the forwarded Cookie header never reaches
 * client JS. Only meaningful in the same-origin, single-Docker deployment
 * described in document/MyReader_Embedded_WebApp.md.
 *
 * The target is NOT built from the incoming request's Host header: when the
 * browser reaches the container through a mapped/published port (e.g.
 * `docker run -p 8082:80`, so `Host: localhost:8082`), that port only exists
 * on the Docker host — it means nothing inside the container's own network
 * namespace, where nginx actually listens on 80/443. Reusing it here caused
 * `fetch` to hit ECONNREFUSED and this endpoint to 502. `MYBOOKS_INTERNAL_ORIGIN`
 * (set in mybooks' conf/supervisor/talebook.conf, program:myreader) points
 * straight at Tornado's loopback address, matching nginx's own `upstream
 * tornado` — one fewer hop than going back out through nginx, and avoids
 * ever having to guess nginx's in-container listen port. Falls back to the
 * request's own origin for local (non-Docker) testing where that env var
 * isn't set.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookie = req.headers.cookie ?? '';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host;
  const internalOrigin = process.env['MYBOOKS_INTERNAL_ORIGIN'] || `${proto}://${host}`;

  try {
    const upstream = await fetch(`${internalOrigin}/api/user/whoami`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Not authenticated' });
    }
    const identity = (await upstream.json()) as WhoamiResponse;
    return res.status(200).json(identity);
  } catch (error) {
    console.error('whoami proxy failed:', error);
    return res.status(502).json({ error: 'MyBooks whoami unreachable' });
  }
}
