import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ORIGINAL_ENV = { ...process.env };

function mockFilepathLookup(body: unknown, status = 200) {
  return vi
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }) as unknown as Response);
}

describe('/api/mybooks/local-file', () => {
  let dir: string;
  let filePath: string;
  const fileContent = 'the quick brown fox jumps over the lazy dog';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mybooks-local-file-'));
    filePath = path.join(dir, 'a book (2024).epub');
    writeFileSync(filePath, fileContent);
    process.env['MYBOOKS_LIBRARY_ROOT'] = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  const makeRequest = (query: string, headers?: Record<string, string>) =>
    new NextRequest(`http://localhost:3000/api/mybooks/local-file?${query}`, { headers });

  it('400s when bookId or format is missing', async () => {
    mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    expect((await GET(makeRequest('format=epub'))).status).toBe(400);
    expect((await GET(makeRequest('bookId=42'))).status).toBe(400);
  });

  it('400s on a format other than epub/pdf, without ever calling MyBooks', async () => {
    const fetchSpy = mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=mobi'));
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries MyBooks server-to-server for the physical path, forwarding the cookie', async () => {
    const fetchSpy = mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    await GET(makeRequest('bookId=42&format=epub', { Cookie: 'user_id=1; lt=abc' }));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/book\/42\/filepath\?format=epub$/),
      expect.objectContaining({ headers: { Cookie: 'user_id=1; lt=abc' } }),
    );
  });

  it('401s when MyBooks reports the session as unauthenticated', async () => {
    mockFilepathLookup({ err: 'user.need_login', msg: 'login' });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(401);
  });

  it('401s when MyBooks reports no read permission', async () => {
    mockFilepathLookup({ err: 'user.no_permission', msg: 'no permission' });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(401);
  });

  it('404s when MyBooks has no such book/format', async () => {
    mockFilepathLookup({ err: 'params.book.invalid', msg: 'not found' });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=999&format=epub'));
    expect(response.status).toBe(404);
  });

  it('502s when MyBooks is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(502);
  });

  it('403s when the MyBooks-returned path escapes the library root (defense in depth)', async () => {
    mockFilepathLookup({ err: 'ok', data: { path: '/etc/passwd' } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(403);
  });

  it('403s when the MyBooks-returned path has an extension other than .epub/.pdf', async () => {
    const txtPath = path.join(dir, 'notes.txt');
    writeFileSync(txtPath, fileContent);
    mockFilepathLookup({ err: 'ok', data: { path: txtPath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(403);
  });

  it('403s when the MyBooks-returned path is fewer than 3 directory levels deep', async () => {
    process.env['MYBOOKS_LIBRARY_ROOT'] = '/x';
    mockFilepathLookup({ err: 'ok', data: { path: '/x/a/book.epub' } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(403);
  });

  it('falls back to /data/books/library when MYBOOKS_LIBRARY_ROOT is unset', async () => {
    delete process.env['MYBOOKS_LIBRARY_ROOT'];
    mockFilepathLookup({ err: 'ok', data: { path: '/data/books/library/some/book.epub' } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    // Passes the whitelist (404s only because the fixture doesn't actually
    // live there in the test environment) — proves the default root is active.
    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(404);
  });

  it('serves the full file with Accept-Ranges when no Range header is sent', async () => {
    mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe(String(fileContent.length));
    expect(await response.text()).toBe(fileContent);
  });

  it('serves a byte range as 206 with Content-Range', async () => {
    mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub', { Range: 'bytes=4-8' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe(`bytes 4-8/${fileContent.length}`);
    expect(response.headers.get('Content-Length')).toBe('5');
    expect(await response.text()).toBe(fileContent.slice(4, 9));
  });

  it('supports HEAD to probe size without a body', async () => {
    mockFilepathLookup({ err: 'ok', data: { path: filePath } });
    const { HEAD } = await import('@/app/api/mybooks/local-file/route');

    const response = await HEAD(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe(String(fileContent.length));
    expect(await response.text()).toBe('');
  });

  it('404s when the resolved file does not actually exist on disk', async () => {
    const missing = path.join(dir, 'missing.epub');
    mockFilepathLookup({ err: 'ok', data: { path: missing } });
    const { GET } = await import('@/app/api/mybooks/local-file/route');

    const response = await GET(makeRequest('bookId=42&format=epub'));
    expect(response.status).toBe(404);
  });
});
