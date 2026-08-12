/**
 * Local File Service
 *
 * Only meaningful in the same-container embedded deployment (see
 * document/MyReader_Embedded_WebApp.md §13): serves a book's bytes straight
 * off the shared filesystem, with HTTP Range support, instead of MyReader
 * downloading the whole file into IndexedDB.
 *
 * The browser only ever supplies `bookId` + `format` — never a physical path.
 * This route resolves the path itself via a server-to-server call to MyBooks'
 * internal-only `/api/book/<id>/filepath` endpoint (nginx-restricted to
 * loopback, see conf/nginx/mybooks.conf), forwarding the browser's cookie so
 * MyBooks can apply its own can_read()/is_active() checks. That single call
 * doubles as auth: a `user.need_login`/`user.no_permission` `err` maps to 401
 * here. The resolved path then still goes through the same path-whitelist +
 * extension + directory-depth checks as before, as defense-in-depth against
 * a misbehaving/compromised MyBooks response.
 */
import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { resolveMyBooksInternalOrigin } from '@/utils/mybooksInternalOrigin';

const MIME_BY_EXT: Record<string, string> = {
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
};

const ALLOWED_FORMATS = new Set(['epub', 'pdf']);

interface FilepathLookupResponse {
  err?: string;
  data?: { path?: string };
}

type FilepathResult = { path: string } | { errorStatus: number };

/**
 * Server-to-server lookup of a book's physical path by bookId + format. Also
 * the sole auth gate for this route — MyBooks' own can_read()/is_active()
 * checks run inside that endpoint, so a login/permission failure there maps
 * straight to 401 here instead of a separate whoami round-trip.
 */
async function resolvePhysicalPath(
  request: NextRequest,
  bookId: string,
  format: string,
): Promise<FilepathResult> {
  const cookie = request.headers.get('cookie') ?? '';
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  const host = request.headers.get('host');
  const internalOrigin = resolveMyBooksInternalOrigin(`${proto}://${host}`);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${internalOrigin}/api/book/${bookId}/filepath?format=${encodeURIComponent(format)}`,
      { headers: cookie ? { Cookie: cookie } : {} },
    );
  } catch {
    return { errorStatus: 502 };
  }
  if (!upstream.ok) return { errorStatus: 502 };

  let body: FilepathLookupResponse;
  try {
    body = (await upstream.json()) as FilepathLookupResponse;
  } catch {
    return { errorStatus: 502 };
  }

  if (body.err === 'user.need_login' || body.err === 'user.no_permission') {
    return { errorStatus: 401 };
  }
  if (body.err !== 'ok' || !body.data?.path) {
    return { errorStatus: 404 };
  }
  return { path: body.data.path };
}

/**
 * Resolve `rawPath` and confirm it lives under `libraryRoot`. Returns the
 * resolved absolute path, or null when it escapes the root (traversal) or
 * either input is empty.
 */
function resolveWithinRoot(rawPath: string, libraryRoot: string): string | null {
  const root = path.resolve(libraryRoot);
  const resolved = path.resolve(root, rawPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// `/data/books/library/book.epub` is the minimum acceptable shape — 3
// directory levels ("data", "books", "library") before the filename. Mainly
// matters when MYBOOKS_LIBRARY_ROOT is overridden to something shallower
// than the default; guards against that override being too permissive
// (e.g. accidentally set to `/` or `/data`).
const MIN_DIRECTORY_DEPTH = 3;

function hasMinDirectoryDepth(resolvedPath: string, minDepth: number): boolean {
  const segments = resolvedPath.split(path.sep).filter(Boolean);
  return segments.length - 1 >= minDepth; // -1 excludes the filename itself
}

// Single-range `bytes=start-end` parsing, which is all RemoteFile ever sends
// (see src/utils/file.ts fetchRangePart). No multipart/suffix-range support.
function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;
  let start = startStr ? Number(startStr) : size - Number(endStr);
  let end = endStr && startStr ? Number(endStr) : size - 1;
  if (!startStr) {
    // suffix range: bytes=-N → last N bytes
    start = Math.max(0, size - Number(endStr));
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || end >= size) {
    return null;
  }
  return { start, end };
}

// Matches tornado's `--with-library` default in mybooks' conf/supervisor/mybooks.conf,
// so the current embedded deployment works with zero extra config. Override via
// MYBOOKS_LIBRARY_ROOT if that deployment ever points `--with-library` elsewhere.
const DEFAULT_LIBRARY_ROOT = '/data/books/library';

async function handle(request: NextRequest, includeBody: boolean): Promise<Response> {
  const libraryRoot = process.env['MYBOOKS_LIBRARY_ROOT'] || DEFAULT_LIBRARY_ROOT;

  const params = new URL(request.url).searchParams;
  const bookId = params.get('bookId');
  const format = params.get('format')?.toLowerCase() ?? '';
  if (!bookId || !format) {
    return new Response('Missing bookId or format', { status: 400 });
  }
  if (!ALLOWED_FORMATS.has(format)) {
    return new Response('Unsupported format', { status: 400 });
  }

  const lookup = await resolvePhysicalPath(request, bookId, format);
  if ('errorStatus' in lookup) {
    return new Response(null, { status: lookup.errorStatus });
  }

  const resolvedPath = resolveWithinRoot(lookup.path, libraryRoot);
  if (!resolvedPath) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!(path.extname(resolvedPath).toLowerCase() in MIME_BY_EXT)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!hasMinDirectoryDepth(resolvedPath, MIN_DIRECTORY_DEPTH)) {
    return new Response('Forbidden', { status: 403 });
  }

  let fileStat;
  try {
    // resolvedPath is a runtime-computed path outside the project tree —
    // Turbopack's file tracer can't statically resolve it and otherwise falls
    // back to bundling the entire monorepo into the standalone output (see
    // document/MyReader_Embedded_WebApp.md §13). The ignore comment tells it
    // this dynamic read is intentional and shouldn't be traced.
    fileStat = await stat(/* turbopackIgnore: true */ resolvedPath);
    if (!fileStat.isFile()) throw new Error('not a file');
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const contentType =
    MIME_BY_EXT[path.extname(resolvedPath).toLowerCase()] ?? 'application/octet-stream';
  const rangeHeader = request.headers.get('range');

  if (rangeHeader) {
    const range = parseRange(rangeHeader, fileStat.size);
    if (!range) {
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileStat.size}` },
      });
    }
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileStat.size}`,
      'Content-Length': String(range.end - range.start + 1),
      'Accept-Ranges': 'bytes',
    });
    if (!includeBody) {
      return new Response(null, { status: 206, headers });
    }
    const nodeStream = createReadStream(/* turbopackIgnore: true */ resolvedPath, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, { status: 206, headers });
  }

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Length': String(fileStat.size),
    'Accept-Ranges': 'bytes',
  });
  if (!includeBody) {
    return new Response(null, { status: 200, headers });
  }
  const nodeStream = createReadStream(/* turbopackIgnore: true */ resolvedPath);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, { status: 200, headers });
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, true);
}

export async function HEAD(request: NextRequest): Promise<Response> {
  return handle(request, false);
}
