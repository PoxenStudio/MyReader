import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';

// Shared by the dictionary relays. Cert validation is off: self-hosted
// MyDict servers commonly use self-signed certs.

/** GET `url` and buffer the body as UTF-8 text. */
export const httpGetText = (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers, rejectUnauthorized: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });

/** GET `target` and hand back the unconsumed response for streaming. */
export const openUpstream = (target: URL, timeoutMs: number): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(
      target,
      { headers: { Accept: '*/*' }, rejectUnauthorized: false },
      resolve,
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
  });

// Image/audio/video/font/CSS only: HTML, SVG or scripts served from the
// reader origin could run with its privileges.
const SAFE_RESOURCE_TYPE_RE =
  /^(?:image\/(?!svg)[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+|font\/[\w.+-]+|text\/css|application\/(?:font-[\w.+-]+|x-font-[\w.+-]+|vnd\.ms-fontobject|octet-stream|ogg))$/i;

export const sanitizeResourceContentType = (contentType: string | null | undefined): string => {
  const value = (contentType ?? '').trim();
  const mime = value.split(';')[0]!.trim();
  return SAFE_RESOURCE_TYPE_RE.test(mime) ? value : 'application/octet-stream';
};

/** Headers that keep a relayed resource from ever rendering as a page. */
export const relayResourceHeaders = (
  contentType: string | null | undefined,
  cacheControl: string | null | undefined,
): Headers =>
  new Headers({
    'Content-Type': sanitizeResourceContentType(contentType),
    'Cache-Control': cacheControl || 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  });
