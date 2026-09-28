import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildMyDictResourceUrl,
  SERVER_DICT_RESOURCE_BASE,
} from '@/services/dictionaries/providers/myDictUrl';

const SERVER = 'http://10.0.0.2:8080';
const SITE_BASE = '/api/mybooks/site-dict/https%3A%2F%2Fbooks.example.com/d1/res';

describe('buildMyDictResourceUrl', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
  });

  afterEach(() => {
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('relays a user MyDict resource through the server-address relay', () => {
    expect(buildMyDictResourceUrl(SERVER, '/dict-res/28/res/SPX/J1.spx')).toBe(
      '/api/mybooks/mydict/res/http%3A%2F%2F10.0.0.2%3A8080/dict-res/28/res/SPX/J1.spx',
    );
  });

  it('relays the env-configured server dictionary through the sentinel base', () => {
    expect(buildMyDictResourceUrl(SERVER_DICT_RESOURCE_BASE, '/dict-res/28/res/SPX/J1.spx')).toBe(
      '/api/mybooks/mydict/res/server/dict-res/28/res/SPX/J1.spx',
    );
  });

  it('appends a site dictionary resource to its relay base as-is', () => {
    expect(buildMyDictResourceUrl(SITE_BASE, '/dict-res/28/res/a b.css')).toBe(
      `${SITE_BASE}/dict-res/28/res/a%20b.css`,
    );
  });

  it('is idempotent: an already-relayed path is not wrapped a second time', () => {
    // 发音点击绑定发生在 absolutizeResourceRefs 改写 href 之后，拿到的是已
    // 中继化的 URL——再 resolve 一次会产生双前缀（上游 400，无声音的根因）。
    for (const base of [SERVER, SERVER_DICT_RESOURCE_BASE, SITE_BASE]) {
      const once = buildMyDictResourceUrl(base, '/dict-res/28/res/SPX/J1.spx');
      expect(buildMyDictResourceUrl(base, once)).toBe(once);
    }
  });

  it('passes absolute http(s) URLs through untouched', () => {
    const url = 'https://a.qianp.com/audio/abc.mp3';
    expect(buildMyDictResourceUrl(SERVER, url)).toBe(url);
  });
});
