import type { NextApiRequest, NextApiResponse } from 'next';

interface WhoamiResponse {
  userId?: number;
  username?: string;
  canRead?: boolean;
  isActive?: boolean;
}

/**
 * Server-to-server bridge for the embedded reader entry point
 * (pages/reader-embed/open.tsx): forwards the browser's MyBooks session
 * cookie to MyBooks' `GET /api/user/whoami` and relays the identity back.
 * Runs on the Next.js server so the forwarded Cookie header never reaches
 * client JS. Only meaningful in the same-origin, single-Docker deployment
 * described in document/MyReader_Embedded_WebApp.md — the target host is
 * derived from the incoming request, not a client-supplied parameter.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookie = req.headers.cookie ?? '';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = req.headers.host;

  try {
    const upstream = await fetch(`${proto}://${host}/api/user/whoami`, {
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
