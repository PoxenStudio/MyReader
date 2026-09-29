import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { myBooksDictProvider } from '@/services/dictionaries/providers/myBooksDictProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const { tauriFetchMock } = vi.hoisted(() => ({ tauriFetchMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetchMock }));

/** Entry content lives in a shadow root; reach it through the host element. */
const shadowOf = (container: HTMLElement): ShadowRoot => {
  const host = container.querySelector('div');
  expect(host?.shadowRoot).toBeTruthy();
  return host!.shadowRoot!;
};

/** One dictionary group per light-DOM `<details>`; content sits in a shadow scope inside. */
const groupDetailsOf = (container: HTMLElement): HTMLDetailsElement[] =>
  Array.from(container.querySelectorAll('details'));

const okResponse = (results: unknown[]) =>
  ({
    ok: true,
    json: async () => ({ results }),
  }) as Response;

describe('MyBooks dictionary provider', () => {
  const originalPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

  beforeEach(() => {
    tauriFetchMock.mockReset();
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform === undefined) delete process.env['NEXT_PUBLIC_APP_PLATFORM'];
    else process.env['NEXT_PUBLIC_APP_PLATFORM'] = originalPlatform;
  });

  it('has the expected provider id', () => {
    expect(myBooksDictProvider.id).toBe(BUILTIN_PROVIDER_IDS.myBooks);
  });

  it('asks for the styled entry HTML and renders it', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 1,
          dictionary_name: 'ECDICT英汉词典',
          word: 'apple',
          phonetic: "'æpl",
          definition: '<p><strong>n.</strong> 苹果</p>',
        },
      ]),
    );
    const container = document.createElement('div');

    const outcome = await myBooksDictProvider.lookup('apple', {
      signal: new AbortController().signal,
      container,
    });

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = tauriFetchMock.mock.calls[0]!;
    // The server strips entry HTML unless `full_style=true` is passed, and
    // all_langs keeps the other-language dictionaries in play for CJK words.
    expect(url).toBe(
      'https://mybooks.top/dict/api/v1/query?word=apple&full_style=true&all_langs=true',
    );
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^Bearer sk-/);

    expect(outcome.ok).toBe(true);
    const shadow = shadowOf(container);
    // 词条内容在 shadow 里；词典名在 light DOM 的 summary 上。
    expect(shadow.textContent).toContain('苹果');
    expect(container.textContent).toContain('ECDICT英汉词典');
    // Markup survives instead of being flattened into plain text.
    expect(shadow.querySelector('strong')?.textContent).toBe('n.');
    // Not the same node as the light-DOM container: the light side only carries
    // the collapse chrome, never entry content.
    expect(container.textContent).not.toContain('苹果');
  });

  it('sanitizes entry HTML before injecting it', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 1,
          dictionary_name: 'Evil',
          word: 'x',
          phonetic: null,
          definition:
            '<p onclick="alert(1)">ok</p><script>alert(2)</script>' +
            '<iframe src="//evil.test"></iframe><form action="//evil.test"><input name="a"></form>' +
            '<a href="javascript:alert(3)">bad</a>',
        },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
    });

    const html = shadowOf(container).innerHTML;
    expect(html).toContain('ok');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('javascript:');
  });

  it("keeps an entry's own styling: legacy tags, custom elements and its CSS", async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 4,
          dictionary_name: '优词词源词典',
          word: 'test',
          phonetic: null,
          definition:
            '<link rel="stylesheet" href="/dict-res/4/res/ciyuan.css">' +
            '<style>.chn{color:red}</style>' +
            '<font color="#008CF2" size="+1">test</font>' +
            '<chn class="c">漢</chn>',
        },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('test', {
      signal: new AbortController().signal,
      container,
    });

    const shadow = shadowOf(container);
    // Dictionary CSS is re-anchored and mounted in the shadow root (DOMPurify
    // drops <link>/<style> on its own).
    const link = shadow.querySelector('link');
    expect(link?.getAttribute('rel')).toBe('stylesheet');
    expect(link?.getAttribute('href')).toBe('https://mybooks.top/dict/dict-res/4/res/ciyuan.css');
    const styles = Array.from(shadow.querySelectorAll('style'));
    expect(styles.some((s) => s.textContent?.includes('.chn{color:red}'))).toBe(true);
    // Legacy presentational markup and the dictionary's own elements carry the
    // typography — dropping them is the "no formatting" bug.
    const font = shadow.querySelector('font');
    expect(font?.getAttribute('color')).toBe('#008CF2');
    expect(font?.getAttribute('size')).toBe('+1');
    expect(shadow.querySelector('chn')?.textContent).toBe('漢');
  });

  it('re-anchors root-relative entry resources to the dictionary server', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 7,
          dictionary_name: 'D',
          word: 'x',
          phonetic: null,
          definition:
            '<img src="/dict-res/7/res/img/a.png"><a href="/dict-res/7/res/audio/a.spx">s</a>',
        },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
    });

    const shadow = shadowOf(container);
    expect(shadow.querySelector('img')?.getAttribute('src')).toBe(
      'https://mybooks.top/dict/dict-res/7/res/img/a.png',
    );
    expect(shadow.querySelector('a')?.getAttribute('href')).toBe(
      'https://mybooks.top/dict/dict-res/7/res/audio/a.spx',
    );
  });

  it('routes entry resources through the same-origin relay on a web build', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    tauriFetchMock.mockReset();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              dictionary_id: 7,
              dictionary_name: 'D',
              word: 'x',
              phonetic: null,
              definition: '<img src="/dict-res/7/res/img/a.png">',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
    });

    // The reader is served over HTTPS and the dictionary server usually isn't:
    // a direct `http://` image would be blocked as mixed content. The relay
    // path mirrors the server's layout so relative `url(…)` refs in the
    // dictionaries' CSS still resolve.
    const src = shadowOf(container).querySelector('img')?.getAttribute('src');
    expect(src).toBe(
      '/api/mybooks/mydict/res/https%3A%2F%2Fmybooks.top%2Fdict/dict-res/7/res/img/a.png',
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not repeat the headword for a lone entry, and keeps group clicks local', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 1,
          dictionary_name: '汉典',
          word: '天性',
          phonetic: 'tiān xìng',
          definition: '<p>天性 天性拼音：tiān xìng</p>',
        },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('天性', {
      signal: new AbortController().signal,
      container,
    });

    const shadow = shadowOf(container);
    // 单条命中的释义自己就带词头，再渲染一遍就是「天性 天性拼音：…」
    expect(shadow.querySelector('.mydict-entry-head')).toBeNull();

    // 点开分组不能连带把外层卡片折叠掉（卡片会裁剪到 max-h-40，等于整块看不见）
    let reachedCard = false;
    container.addEventListener('click', () => {
      reachedCard = true;
    });
    container
      .querySelector('summary')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(reachedCard).toBe(false);
  });

  it('groups hits by dictionary and collapses all but the first', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        { dictionary_id: 1, dictionary_name: 'A', word: 'x', phonetic: null, definition: 'a1' },
        { dictionary_id: 1, dictionary_name: 'A', word: 'x', phonetic: null, definition: 'a2' },
        { dictionary_id: 2, dictionary_name: 'B', word: 'x', phonetic: null, definition: 'b1' },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
    });

    const groups = groupDetailsOf(container);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.open).toBe(true);
    expect(groups[1]!.open).toBe(false);
    // Homographs inside one dictionary get an index header (rendered in the
    // group's shadow scope, not in the light DOM).
    const firstScope = groups[0]!.querySelector('.dict-shadow-host')!.shadowRoot!;
    expect(firstScope.querySelectorAll('section').length).toBe(2);
    expect(firstScope.textContent).toContain('1/2');
  });

  it('marks hits that only matched after a fallback to another language', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 9,
          dictionary_name: 'Fallback',
          word: 'x',
          phonetic: null,
          definition: 'd',
          lang_match: false,
        },
      ]),
    );
    const container = document.createElement('div');

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
    });

    expect(container.querySelector('.mydict-lang-badge')?.textContent).toBe('Other language');
  });

  it('follows entry:// cross-references through onNavigate', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 1,
          dictionary_name: 'D',
          word: 'x',
          phonetic: null,
          definition: '<a href="entry://apple">apple</a>',
        },
      ]),
    );
    const container = document.createElement('div');
    const onNavigate = vi.fn();

    await myBooksDictProvider.lookup('x', {
      signal: new AbortController().signal,
      container,
      onNavigate,
    });

    const link = shadowOf(container).querySelector('a')!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith('apple');
  });

  it('decodes percent-encoded entry:// targets (Weblio dictionaries)', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 30,
          dictionary_name: 'Weblio類語辞典',
          word: '人気',
          phonetic: null,
          // 広く（URL 编码）——不解码就会拿 %E5%BA%83%E3%81%8F 去查词，命中不到
          definition: '<a class="crosslink" href="entry://%E5%BA%83%E3%81%8F">広く</a>',
        },
      ]),
    );
    const container = document.createElement('div');
    const onNavigate = vi.fn();

    await myBooksDictProvider.lookup('人気', {
      signal: new AbortController().signal,
      container,
      onNavigate,
    });

    const link = shadowOf(container).querySelector('a')!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith('広く');
  });

  it('strips the anchor from entry://word#anchor targets', async () => {
    tauriFetchMock.mockResolvedValueOnce(
      okResponse([
        {
          dictionary_id: 59,
          dictionary_name: '牛津高阶英汉双解词典（第10版）V3',
          word: 'dirty',
          phonetic: null,
          // 牛津系 idm 交叉引用：词头 + 词条内锚点，整串查不到词
          definition: '<a href="entry://dirty_1#down_idmg_5">dirty</a>',
        },
      ]),
    );
    const container = document.createElement('div');
    const onNavigate = vi.fn();

    await myBooksDictProvider.lookup('dirty', {
      signal: new AbortController().signal,
      container,
      onNavigate,
    });

    const link = shadowOf(container).querySelector('a')!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledWith('dirty_1');
  });

  it('reports an empty outcome when results is empty', async () => {
    tauriFetchMock.mockResolvedValueOnce(okResponse([]));
    const container = document.createElement('div');

    const outcome = await myBooksDictProvider.lookup('zzznotaword', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('reports an error outcome on HTTP failure', async () => {
    tauriFetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const container = document.createElement('div');

    const outcome = await myBooksDictProvider.lookup('apple', {
      signal: new AbortController().signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });

  it('relays through the same-origin MyDict proxy on a web build', async () => {
    process.env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              dictionary_name: 'ECDICT英汉词典',
              word: 'apple',
              phonetic: null,
              definition: 'n. 苹果',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const container = document.createElement('div');

    const outcome = await myBooksDictProvider.lookup('apple', {
      signal: new AbortController().signal,
      container,
    });

    expect(tauriFetchMock).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/mybooks/mydict/query');
    const body = JSON.parse(String(init!.body));
    expect(body.url).toBe('https://mybooks.top/dict');
    expect(body.token).toMatch(/^sk-/);
    expect(body.word).toBe('apple');
    expect(outcome.ok).toBe(true);
    expect(shadowOf(container).textContent).toContain('苹果');
  });
});

describe('renderMyBooksResults — resource URLs', () => {
  it('never puts an un-relayed /dict-res/ URL into the live DOM', async () => {
    const { renderMyBooksResults } = await import(
      '@/services/dictionaries/providers/myBooksDictProvider'
    );
    // Any src/href rewritten after insertion means the browser already fetched
    // the root-relative URL from the reader's own origin (a 404).
    const rewrittenLive: string[] = [];
    const observers: MutationObserver[] = [];
    const attachShadow = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      const root = attachShadow.call(this, init);
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes' && r.oldValue?.startsWith('/dict-res/')) {
            rewrittenLive.push(r.oldValue);
          }
        }
      });
      observer.observe(root, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['src', 'href'],
      });
      observers.push(observer);
      return root;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderMyBooksResults(
      [
        {
          dictionary_id: 9,
          dictionary_name: 'D',
          word: 'w',
          definition:
            '<link rel="stylesheet" href="/dict-res/9/res/a.css"><img src="/dict-res/9/res/v.png">',
        },
      ],
      container,
      { baseUrl: 'http://mydict.test' },
    );
    await Promise.resolve();
    observers.forEach((o) => o.disconnect());

    const shadow = container.querySelector('.dict-shadow-host')!.shadowRoot!;
    expect(shadow.querySelector('img')!.getAttribute('src')).toContain('mydict.test');
    expect(shadow.querySelector('link')!.getAttribute('href')).toContain('mydict.test');
    expect(rewrittenLive).toEqual([]);
    container.remove();
  });
});

describe('renderMyBooksResults — script-dependent dictionaries', () => {
  it('shows The little dict pronunciation icons that its own script would reveal', async () => {
    const { renderMyBooksResults } = await import(
      '@/services/dictionaries/providers/myBooksDictProvider'
    );
    const container = document.createElement('div');
    renderMyBooksResults(
      [{ dictionary_id: 9, dictionary_name: 'D', word: 'w', definition: '<div class="pf"></div>' }],
      container,
      { baseUrl: '' },
    );
    const shadow = container.querySelector('.dict-shadow-host')!.shadowRoot!;
    const css = shadow.querySelector('style')!.textContent!.replace(/\s+/g, ' ');
    expect(css).toContain('.pf > a > img { display: inline-block !important; }');
  });
});
