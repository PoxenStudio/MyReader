import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/api/mybooks/_shared/upstream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mybooks/_shared/upstream')>();
  return { ...actual, httpGetText: vi.fn(), httpJsonRequest: vi.fn() };
});

import { httpGetText, httpJsonRequest } from '@/app/api/mybooks/_shared/upstream';
import { POST as postVocab } from '@/app/api/mybooks/mydict/vocab/route';
import { POST as postServerVocab } from '@/app/api/mybooks/mydict/server-vocab/route';

const request = (body: unknown) =>
  new NextRequest('http://reader.local/api/mybooks/mydict/vocab', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const routes = [
  ['vocab', (body: Record<string, unknown>) => postVocab(request({ url: 'http://d', ...body }))],
  ['server-vocab', (body: Record<string, unknown>) => postServerVocab(request(body))],
] as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe.each(routes)('%s relay', (_name, post) => {
  it('turns a non-JSON upstream body into a clean 502', async () => {
    vi.stubEnv('MYDICT_SERVER_URL', 'http://d');
    vi.mocked(httpGetText).mockResolvedValue({ status: 502, text: '<html>Bad Gateway</html>' });
    const res = await post({ action: 'list', word: 'ran' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Invalid response (HTTP 502)' });
  });

  it.each([1.5, -3, 0])('rejects item_id %s without calling upstream', async (itemId) => {
    vi.stubEnv('MYDICT_SERVER_URL', 'http://d');
    const res = await post({ action: 'remove', item_id: itemId });
    expect(res.status).toBe(400);
    expect(httpJsonRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-integer dictionary_id without calling upstream', async () => {
    vi.stubEnv('MYDICT_SERVER_URL', 'http://d');
    const res = await post({ action: 'add', word: 'ran', dictionary_id: 4.2 });
    expect(res.status).toBe(400);
    expect(httpJsonRequest).not.toHaveBeenCalled();
  });
});
