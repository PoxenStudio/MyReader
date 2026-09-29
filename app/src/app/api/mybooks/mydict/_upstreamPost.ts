import http from 'node:http';
import https from 'node:https';

/**
 * POST a JSON body to a MyDict server from a relay route.
 *
 * Deliberately uses `node:http(s)` with certificate validation off rather than
 * `fetch`: self-hosted MyDict servers normally sit on the LAN with a
 * self-signed certificate (the same reason the sibling query/resource relays
 * do this).
 */
export const upstreamJsonPost = (
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs = 15000,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = client.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
        rejectUnauthorized: false,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
