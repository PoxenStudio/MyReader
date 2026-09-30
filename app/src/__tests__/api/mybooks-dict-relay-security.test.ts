import { Readable } from 'node:stream';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/api/mybooks/_shared/upstream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mybooks/_shared/upstream')>();
  return { ...actual, openUpstream: vi.fn() };
});

import { openUpstream, sanitizeResourceContentType } from '@/app/api/mybooks/_shared/upstream';
import { GET as getMyDictResource } from '@/app/api/mybooks/mydict/res/[...path]/route';
import {
  DELETE as deleteSiteDict,
  GET as getSiteDict,
  POST as postSiteDict,
} from '@/app/api/mybooks/site-dict/[...path]/route';
import {
  GET as getUserSettings,
  PUT as putUserSettings,
} from '@/app/api/mybooks/mydict/user-settings/route';

const params = (path: string[]) => ({ params: Promise.resolve({ path }) });

const fakeUpstream = (body: string, headers: Record<string, string>, statusCode = 200) =>
  Object.assign(Readable.from([Buffer.from(body)]), {
    statusCode,
    headers,
  }) as never;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('sanitizeResourceContentType', () => {
  it.each([
    'image/png',
    'audio/mpeg',
    'font/woff2',
    'text/css; charset=utf-8',
    'video/mp4',
  ])('keeps %s', (type) => {
    expect(sanitizeResourceContentType(type)).toBe(type);
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'text/xml',
    '',
    undefined,
  ])('downgrades %s to octet-stream', (type) => {
    expect(sanitizeResourceContentType(type)).toBe('application/octet-stream');
  });
});

describe('/api/mybooks/mydict/res — response hardening', () => {
  it('never serves upstream HTML as a page on the reader origin', async () => {
    vi.mocked(openUpstream).mockResolvedValue(
      fakeUpstream('<script>alert(1)</script>', {
        'content-type': 'text/html',
      }),
    );
    const response = await getMyDictResource(
      new NextRequest('http://reader.test/api/mybooks/mydict/res/x'),
      params(['http://evil.test', 'dict-res', '1', 'res', 'x.html']),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('passes dictionary stylesheets through untouched', async () => {
    vi.mocked(openUpstream).mockResolvedValue(
      fakeUpstream('b{color:red}', { 'content-type': 'text/css' }),
    );
    const response = await getMyDictResource(
      new NextRequest('http://reader.test/api/mybooks/mydict/res/x'),
      params(['http://192.168.1.5:8000', 'dict-res', '1', 'res', 'a.css']),
    );
    expect(response.headers.get('Content-Type')).toBe('text/css');
    expect(await response.text()).toBe('b{color:red}');
  });
});

describe('/api/mybooks/site-dict — cookie forwarding', () => {
  const cookieSentTo = async (host: string, headers: Record<string, string>) => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await getSiteDict(
      new NextRequest('http://reader.test/api/mybooks/site-dict/x/config', {
        headers: { cookie: 'user_id=secret', ...headers },
      }),
      params([host, 'config']),
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    return (init.headers as Record<string, string>)['Cookie'];
  };

  beforeEach(() => {
    vi.stubEnv('MYBOOKS_INTERNAL_ORIGIN', '');
  });

  it('forwards the cookie to a MyBooks host on the request origin', async () => {
    expect(
      await cookieSentTo('https://books.example.com', {
        host: 'internal:3000',
        'x-forwarded-host': 'books.example.com',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('user_id=secret');
  });

  it('does not leak the cookie to a foreign host', async () => {
    expect(
      await cookieSentTo('https://evil.test', {
        host: 'books.example.com',
        'x-forwarded-proto': 'https',
      }),
    ).toBeUndefined();
  });

  it('always forwards to the configured internal origin', async () => {
    vi.stubEnv('MYBOOKS_INTERNAL_ORIGIN', 'http://127.0.0.1:8080');
    expect(
      await cookieSentTo('https://whatever.test', {
        host: 'books.example.com',
      }),
    ).toBe('user_id=secret');
  });

  it('hardens relayed entry resources', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    const response = await getSiteDict(
      new NextRequest('http://reader.test/api/mybooks/site-dict/x'),
      params(['https://books.example.com', 'abc', 'res', 'dict-res', 'x.html']),
    );
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
  });
});

describe('/api/mybooks/site-dict — wordbook relay', () => {
  const HOST = 'https://books.example.com';
  const req = (method: string, body?: unknown) =>
    new NextRequest('http://reader.test/api/mybooks/site-dict/x?search=ran', {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const upstream = () => {
    const spy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    return () => {
      const [url, init] = spy.mock.calls[0]!;
      return { url: String(url), init: init as RequestInit };
    };
  };

  beforeEach(() => {
    vi.stubEnv('MYBOOKS_INTERNAL_ORIGIN', '');
  });

  it('lists with the search term', async () => {
    const call = upstream();
    await getSiteDict(req('GET'), params([HOST, 'abc', 'vocab']));
    expect(call().url).toBe(`${HOST}/api/reader/dict/abc/vocab?search=ran`);
  });

  it('forwards an add as a JSON POST', async () => {
    const call = upstream();
    await postSiteDict(
      req('POST', { word: 'ran', dictionary_id: 4 }),
      params([HOST, 'abc', 'vocab']),
    );
    const { url, init } = call();
    expect(url).toBe(`${HOST}/api/reader/dict/abc/vocab`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ word: 'ran', dictionary_id: 4 });
  });

  it('forwards a remove as a DELETE of that item', async () => {
    const call = upstream();
    await deleteSiteDict(req('DELETE'), params([HOST, 'abc', 'vocab', '42']));
    const { url, init } = call();
    expect(url).toBe(`${HOST}/api/reader/dict/abc/vocab/42`);
    expect(init.method).toBe('DELETE');
  });

  it.each([
    ['POST', ['abc', 'query']],
    ['POST', ['config']],
    ['DELETE', ['abc', 'vocab']],
    ['DELETE', ['abc', 'vocab', 'x']],
    ['GET', ['abc', 'vocab', '42']],
  ] as const)('refuses %s %j', async (method, rest) => {
    const spy = vi.spyOn(global, 'fetch');
    const handler = { GET: getSiteDict, POST: postSiteDict, DELETE: deleteSiteDict }[method];
    const response = await handler(
      req(method, method === 'POST' ? {} : undefined),
      params([HOST, ...rest]),
    );
    expect(response.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('/api/mybooks/mydict/user-settings — identity', () => {
  it('fails closed without MYBOOKS_INTERNAL_ORIGIN instead of trusting Host', async () => {
    vi.stubEnv('MYBOOKS_INTERNAL_ORIGIN', '');
    const fetchSpy = vi.spyOn(global, 'fetch');
    const response = await getUserSettings(
      new NextRequest('http://reader.test/api/mybooks/mydict/user-settings', {
        headers: { host: 'evil.test' },
      }),
    );
    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies', async () => {
    vi.stubEnv('MYBOOKS_INTERNAL_ORIGIN', 'http://127.0.0.1:8080');
    vi.spyOn(global, 'fetch').mockResolvedValue(Response.json({ userId: 7 }));
    const response = await putUserSettings(
      new NextRequest('http://reader.test/api/mybooks/mydict/user-settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: { providerOrder: ['x'.repeat(70 * 1024)] },
        }),
      }),
    );
    expect(response.status).toBe(413);
  });
});
