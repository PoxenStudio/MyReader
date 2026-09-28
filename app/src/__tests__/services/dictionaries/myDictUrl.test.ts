import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildMyDictResourceUrl,
  SERVER_DICT_RESOURCE_BASE,
} from '@/services/dictionaries/providers/myDictUrl';

describe('buildMyDictResourceUrl', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
  });

  afterEach(() => {
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('relays a root-relative resource through the sentinel base', () => {
    expect(buildMyDictResourceUrl(SERVER_DICT_RESOURCE_BASE, '/dict-res/28/res/SPX/J1.spx')).toBe(
      '/api/mybooks/mydict/res/server/dict-res/28/res/SPX/J1.spx',
    );
  });

  it('is idempotent: an already-relayed path is not wrapped a second time', () => {
    // 发音点击绑定发生在 absolutizeResourceRefs 改写 href 之后，拿到的是已
    // 中继化的 URL——再 resolve 一次会产生双前缀（上游 400，无声音的根因）。
    const once = buildMyDictResourceUrl(SERVER_DICT_RESOURCE_BASE, '/dict-res/28/res/SPX/J1.spx');
    expect(buildMyDictResourceUrl(SERVER_DICT_RESOURCE_BASE, once)).toBe(once);
  });

  it('passes absolute http(s) URLs through untouched', () => {
    const url = 'https://a.qianp.com/audio/abc.mp3';
    expect(buildMyDictResourceUrl(SERVER_DICT_RESOURCE_BASE, url)).toBe(url);
  });
});
