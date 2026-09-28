import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Per-user sync for the dictionary panel settings (provider order, enable
 * flags, user-added MyDict servers, web searches, font scale).
 *
 * This is the missing half of cross-device dictionaries on the embedded web
 * build: those settings live in each browser's IndexedDB and are excluded
 * from settings sync upstream (`myDicts` is not even in Readest's settings
 * whitelist), so a toggle made on one device never reached another.
 *
 * Storage is a small JSON file per MyBooks user under `/data/reader/` (the
 * directory start.sh already creates for the embedded reader), written by the
 * Next.js server process — MyBooks itself is untouched, so a MyBooks image
 * update cannot drop the feature.
 *
 * Auth mirrors `pages/api/mybooks/whoami.ts`: the browser's MyBooks session
 * cookie is forwarded to Tornado's `/api/user/whoami` over
 * `MYBOOKS_INTERNAL_ORIGIN`, and the file is keyed by that user id — users
 * never see each other's settings, and the request's Host header is never
 * trusted for the upstream target.
 */
const TIMEOUT_MS = 15000;
const SETTINGS_DIR = process.env['READER_SETTINGS_DIR'] || '/data/reader/dict-settings';

/** Only these SystemSettings keys are accepted for sync. */
const ALLOWED_KEYS = new Set([
  'providerOrder',
  'providerEnabled',
  'myDicts',
  'serverDicts',
  'webSearches',
  'fontScale',
  'defaultProviderId',
]);

type WhoamiResponse = { userId?: number };

const resolveUser = async (request: NextRequest): Promise<number | null> => {
  const cookie = request.headers.get('cookie') ?? '';
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  const host = request.headers.get('host') ?? '';
  const internalOrigin = process.env['MYBOOKS_INTERNAL_ORIGIN'] || `${proto}://${host}`;
  try {
    const upstream = await fetch(`${internalOrigin}/api/user/whoami`, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return null;
    const identity = (await upstream.json()) as WhoamiResponse;
    return typeof identity.userId === 'number' ? identity.userId : null;
  } catch {
    return null;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keep only the syncable dictionary keys, with light shape checks. */
const sanitize = (input: unknown): Record<string, unknown> | null => {
  if (!isPlainObject(input)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (
      key === 'providerOrder' &&
      (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    )
      continue;
    if (key === 'providerEnabled' && !isPlainObject(value)) continue;
    if (key === 'myDicts' && !Array.isArray(value)) continue;
    if (key === 'serverDicts' && !Array.isArray(value)) continue;
    if (key === 'webSearches' && !Array.isArray(value)) continue;
    if (key === 'fontScale' && typeof value !== 'number') continue;
    if (key === 'defaultProviderId' && typeof value !== 'string' && value !== null) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
};

export async function GET(request: NextRequest) {
  const userId = await resolveUser(request);
  if (userId === null) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  try {
    const text = await fsp.readFile(path.join(SETTINGS_DIR, `${userId}.json`), 'utf8');
    return NextResponse.json(JSON.parse(text), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'No synced settings' }, { status: 404 });
    }
    console.error(`[MyDict Settings] read failed for user ${userId}:`, error);
    return NextResponse.json({ error: 'Read failed' }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  const userId = await resolveUser(request);
  if (userId === null) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isPlainObject(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const settings = sanitize(body['settings']);
  if (!settings) {
    return NextResponse.json({ error: 'No syncable dictionary settings' }, { status: 400 });
  }

  const updatedAt = Date.now();
  const file = path.join(SETTINGS_DIR, `${userId}.json`);
  try {
    await fsp.mkdir(SETTINGS_DIR, { recursive: true });
    await fsp.writeFile(file, JSON.stringify({ updatedAt, settings }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    console.error(`[MyDict Settings] write failed for user ${userId}:`, error);
    return NextResponse.json({ error: 'Write failed' }, { status: 502 });
  }
  return NextResponse.json(
    { updatedAt },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
