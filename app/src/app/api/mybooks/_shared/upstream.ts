import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { NextResponse } from 'next/server';

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

// Image/audio/video/font/CSS only: HTML or scripts served from the reader
// origin could run with its privileges. SVG (image/svg+xml) is allowed on
// purpose: scripts never run for SVG in <img>/CSS backgrounds, and top-level
// navigation is neutralised by the `CSP: sandbox` header below. Excluding it
// downgraded dictionary-bracket icons (広辞苑) to octet-stream + nosniff, so
// every <img> refused to paint.
const SAFE_RESOURCE_TYPE_RE =
  /^(?:image\/[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+|font\/[\w.+-]+|text\/css|application\/(?:font-[\w.+-]+|x-font-[\w.+-]+|vnd\.ms-fontobject|octet-stream|ogg))$/i;

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

/**
 * POST/DELETE `url` with a JSON body and buffer the JSON/text response.
 *
 * The wordbook (生词本) relay is the only writer among the dictionary relays:
 * it needs POST (add) and DELETE (remove) against `/api/v1/vocab`. Same
 * certificate handling as {@link httpGetText}.
 */
export const httpJsonRequest = (
  method: 'POST' | 'DELETE',
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = client.request(
      target,
      {
        method,
        headers: {
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
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
    if (payload) req.write(payload);
    req.end();
  });

/** Positive integer id (dictionary / wordbook item) taken from a JSON body. */
export const isPositiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * Pass an upstream JSON reply through (2xx → 200, 4xx/5xx kept). A non-JSON
 * body — e.g. a reverse proxy's HTML error page — becomes a plain 502.
 */
export const relayJsonReply = ({ status, text }: { status: number; text: string }) => {
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: `Invalid response (HTTP ${status})` }, { status: 502 });
    }
  }
  return NextResponse.json(data, { status: status >= 200 && status < 300 ? 200 : status });
};
