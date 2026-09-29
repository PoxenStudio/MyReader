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
 * never see each other's settings. No Host-header fallback (a forged Host
 * could claim any user id): without the env var the route returns 503.
 */
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;
const SETTINGS_DIR = process.env['READER_SETTINGS_DIR'] || '/data/reader/dict-settings';

/** Syncable keys; `defaultProviderId` (last-used tab) stays per-device. */
const ALLOWED_KEYS = new Set([
  'providerOrder',
  'providerEnabled',
  'myDicts',
  'serverDicts',
  'webSearches',
  'fontScale',
]);

type WhoamiResponse = { userId?: number };

const NOT_CONFIGURED = 'not-configured' as const;

const resolveUser = async (
  request: NextRequest,
): Promise<number | null | typeof NOT_CONFIGURED> => {
  const internalOrigin = process.env['MYBOOKS_INTERNAL_ORIGIN'];
  if (!internalOrigin) return NOT_CONFIGURED;
  const cookie = request.headers.get('cookie') ?? '';
  try {
    const upstream = await fetch(`${internalOrigin}/api/user/whoami`, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return null;
    const identity = (await upstream.json()) as WhoamiResponse;
    return typeof identity.userId === 'number' && Number.isSafeInteger(identity.userId)
      ? identity.userId
      : null;
  } catch {
    return null;
  }
};

const authError = (userId: null | typeof NOT_CONFIGURED) =>
  userId === NOT_CONFIGURED
    ? NextResponse.json({ error: 'Settings sync is not configured' }, { status: 503 })
    : NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

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
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
};

export async function GET(request: NextRequest) {
  const userId = await resolveUser(request);
  if (userId === null || userId === NOT_CONFIGURED) return authError(userId);
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
  if (userId === null || userId === NOT_CONFIGURED) return authError(userId);

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Body too large' }, { status: 413 });
    }
    body = JSON.parse(raw);
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
    // Write-then-rename: concurrent saves never leave a torn file.
    const tmp = `${file}.${process.pid}.${updatedAt}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ updatedAt, settings }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(tmp, file);
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
