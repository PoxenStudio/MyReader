/**
 * Built-in MyBooks dictionary provider.
 *
 * Queries the user's self-hosted MyBooks dictionary API (ECDICT + Chinese
 * dictionaries) — `GET /api/v1/query?word=…` with a fixed bearer token.
 * Same API as user-added MyDict servers, so it shares `queryMyDict` — native
 * builds go through `@tauri-apps/plugin-http`, the web build relays through
 * `/api/mybooks/mydict/query` (the API sends no CORS headers).
 */
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { sanitizeDictionaryHtml } from '@/utils/sanitize';
import { BUILTIN_PROVIDER_IDS } from '../types';
import type { DictionaryLookupOutcome, DictionaryProvider } from '../types';
import { queryMyDict, type MyDictResult } from './myDictQuery';
import { buildMyDictResourceUrl } from './myDictUrl';
import { AUDIO_BOUND, wireDictAudio } from '../dictAudio';

const MYBOOKS_DICT_URL = 'https://mybooks.top/dict';

// MyBooks词典服务分配的token, 限流控制
const MYBOOKS_DICT_TOKEN = 'sk-ut5X97HcuelppOw90x3rcPuyyO5oYZLFCBAxE6LA6_g';

/** What {@link renderMyBooksResults} needs beyond the results themselves. */
export interface MyBooksRenderOptions {
  /**
   * Base address of the dictionary server. Entry resources arrive as
   * root-relative `/dict-res/<id>/res/…` (the server rewrites them at import
   * time), so they must be re-anchored to the server that served them.
   */
  baseUrl: string;
  /** Follow an in-entry `entry://word` cross-reference. */
  onNavigate?: (word: string) => void;
  /** Real translation function; absent in unit tests. */
  _?: (key: string) => string;
  /** 书的内容语言（如 'ja'）——语言标签默认落在这一组。 */
  lang?: string;
  isDarkMode?: boolean;
}

/** Root-relative prefix the server puts on entry resources. */
const RESOURCE_PREFIX = '/dict-res/';
/** MDict cross-reference scheme, left intact by the server on purpose. */
const ENTRY_LINK_PREFIX = 'entry://';

/**
 * Coarse language bucket for a language code (zh-Hans/zh-Hant both land on
 * `zh` — the dictionaries render their own variants). Handles both ISO 639-1
 * (`ja`) and 639-2/B (`jpn`) — Calibre 记录的是三字码，书页弹窗透传的就是它。
 */
const langBucket = (lang?: string | null): string => {
  const code = (lang ?? '').toLowerCase();
  if (code.startsWith('zh') || code.startsWith('zho')) return 'zh';
  if (code.startsWith('ja') || code.startsWith('jpn')) return 'ja';
  if (code.startsWith('en') || code.startsWith('eng')) return 'en';
  return code || '';
};

/** Language-native display names for the filter tabs. */
const LANG_TAB_NAMES: Record<string, string> = {
  zh: '中文',
  ja: '日本語',
  en: 'English',
};

/**
 * Baseline presentation for entry content, scoped to the card's shadow root
 * (so it can't leak into the reader chrome). Colours are all `currentColor`
 * based — the entries themselves carry the dictionaries' own styling, and the
 * app theme supplies the rest.
 */
const BASELINE_CSS = `
  /* overflow-x: clip (not hidden) — "clip" may pair with a visible vertical
     axis, so this doesn't turn the card into a scroll container.
     Dictionaries routinely lay their entries out wider than a popup panel
     (fixed-width tables, banner images); without this the card grows a
     horizontal scrollbar. MyDict's own entry renderer does the same. */
  :host { display: block; overflow-x: clip; }
  /* flow-root contains the dictionaries' floated layouts: the 千篇 bundle's
     leftbox column is a float and 1300px+ tall — in a plain block the body
     collapses to zero height and the floated content overlaps every group
     below it, which reads as "the other dictionaries vanished". */
  .mydict-entry-body { display: flow-root; overflow-x: clip; }
  img, video { max-width: 100%; height: auto; }
  audio { max-width: 100%; }
  table { border-collapse: collapse; max-width: 100%; }
  th, td { padding: 0.25em 0.5em; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
  hr { border: 0; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
  a { color: inherit; }
  details.mydict-group[hidden] { display: none !important; }
  .mydict-lang-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35em;
    margin: 0.4em 0 0.6em;
  }
  .mydict-lang-tab {
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    border-radius: 999px;
    padding: 0.1em 0.7em;
    font-size: 0.78em;
    cursor: pointer;
    opacity: 0.7;
    background: transparent;
    color: inherit;
  }
  .mydict-lang-tab.active {
    background: color-mix(in srgb, currentColor 12%, transparent);
    opacity: 1;
  }
  details.mydict-group + details.mydict-group {
    margin-top: 0.6em;
    padding-top: 0.6em;
    border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  }
  summary.mydict-group-head {
    display: flex;
    align-items: baseline;
    gap: 0.4em;
    cursor: pointer;
    font-size: 0.9em;
    outline-offset: 2px;
  }
  /* The native disclosure marker lands in the wrong place once the summary is
     a flex box, so it is replaced by an explicit chevron below. */
  summary.mydict-group-head::marker,
  summary.mydict-group-head::-webkit-details-marker {
    content: '';
    display: none;
  }
  .mydict-group-chevron {
    flex: none;
    width: 0;
    height: 0;
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    border-left: 5px solid currentColor;
    opacity: 0.5;
    transform-origin: 25% 50%;
    transition: transform 0.15s ease;
  }
  details[open] > summary.mydict-group-chevron,
  details[open] > summary .mydict-group-chevron {
    transform: rotate(90deg);
  }
  summary.mydict-group-head:hover { color: color-mix(in srgb, currentColor 75%, transparent); }
  summary.mydict-group-head:hover .mydict-group-chevron { opacity: 0.8; }
  .mydict-group-name { font-weight: 600; }
  .mydict-group-count,
  .mydict-lang-badge {
    font-size: 0.75em;
    font-weight: 400;
    opacity: 0.65;
  }
  .mydict-lang-badge {
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: 4px;
    padding: 0 0.35em;
  }
  .mydict-group-body { margin-top: 0.4em; }
  .mydict-entry + .mydict-entry {
    margin-top: 0.6em;
    padding-top: 0.5em;
    border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
  .mydict-entry-head {
    margin-bottom: 0.35em;
    font-size: 0.8em;
    opacity: 0.75;
  }
  .mydict-entry-index {
    display: inline-block;
    min-width: 1.8em;
    margin-right: 0.3em;
    font-variant-numeric: tabular-nums;
  }
  .mydict-entry-word { font-weight: 600; }
  .mydict-entry-phonetic { margin-left: 0.35em; }
`;

/**
 * Re-anchor the server's root-relative `/dict-res/<id>/res/…` references so a
 * rendered entry can actually load them. Without this the browser resolves them
 * against the reader's own origin and every image/audio/font 404s.
 *
 * Covers the attributes the server rewrites — `src`/`href`, including the
 * `sound://` links it turned into `<a href="/dict-res/…">`. `url(…)` inside the
 * dictionaries' own CSS resolves relative to that CSS file and needs no help.
 *
 * Runs over the whole shadow root, so it also fixes up the `<link>`s the caller
 * lifted out of the entries.
 */
const absolutizeResourceRefs = (root: ShadowRoot, baseUrl: string): void => {
  if (!baseUrl.trim()) return;
  const selector = 'img[src], audio[src], video[src], source[src], track[src], a[href], link[href]';
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const raw = el.getAttribute(attr);
    if (!raw || !raw.startsWith(RESOURCE_PREFIX)) return;
    el.setAttribute(attr, buildMyDictResourceUrl(baseUrl, raw));
  });
};

/* ------------------------------------------------------------- entry CSS */

// DOMPurify drops `<link>`/`<style>` unconditionally — they are not inert
// inline markup, they would apply outside the sanitized subtree. A dictionary
// that ships CSS next to its `.mdx` (大辞泉, 千篇汉语词典, 优词词源词典 …) needs
// it all the same, so the renderer lifts those out and mounts them into the
// card's shadow root, where they are scoped to the card and cannot reach the
// reader's own UI.
const STYLE_LINK_RE = /<link\b[^>]*>/gi;
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const ATTR_RE = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
const REL_ATTR_RE = ATTR_RE('rel');
const HREF_ATTR_RE = ATTR_RE('href');
/** A runaway entry shouldn't be able to make the card load hundreds of sheets. */
const MAX_ENTRY_STYLES = 20;

const attrValue = (tag: string, re: RegExp): string | undefined => {
  const match = re.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
};

const extractEntryStyles = (html: string): (HTMLLinkElement | HTMLStyleElement)[] => {
  const nodes: (HTMLLinkElement | HTMLStyleElement)[] = [];

  for (const match of html.matchAll(STYLE_LINK_RE)) {
    if (nodes.length >= MAX_ENTRY_STYLES) break;
    if (!/stylesheet/i.test(attrValue(match[0], REL_ATTR_RE) ?? '')) continue;
    const href = attrValue(match[0], HREF_ATTR_RE);
    if (!href) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', href);
    nodes.push(link);
  }

  for (const match of html.matchAll(STYLE_BLOCK_RE)) {
    if (nodes.length >= MAX_ENTRY_STYLES) break;
    const style = document.createElement('style');
    // `textContent`, never `innerHTML`: CSS is not markup and must not be
    // parsed as such.
    style.textContent = match[1] ?? '';
    nodes.push(style);
  }

  return nodes;
};

/** Wire in-entry links: `entry://word` navigates, http(s) leaves the popup. */
const wireLinks = (root: HTMLElement, onNavigate?: (word: string) => void): void => {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    if (anchor.dataset[AUDIO_BOUND]) return; // 发音点击已由 dictAudio 接管
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith(ENTRY_LINK_PREFIX)) {
      if (!onNavigate) return;
      anchor.addEventListener('click', (event) => {
        const word = href.slice(ENTRY_LINK_PREFIX.length).trim();
        if (!word) return;
        event.preventDefault();
        onNavigate(word);
      });
      return;
    }
    if (!/^https?:\/\//i.test(href)) return;
    // The popup's own link delegation can't see into a shadow root (`event
    // .target` is retargeted to the host), so links are handled here: Tauri
    // has no working `target="_blank"`, the web build does — same split the
    // popup's `handleContainerClick` makes.
    if (isTauriAppPlatform()) {
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        void openUrl(href).catch((error) => {
          console.warn('Failed to open dictionary link', href, error);
        });
      });
    } else {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
};

/* --------------------------------------------- dark-mode entry adaptation */

// Dictionaries hardcode their colours, and dark blue on a dark theme is
// unreadable. The set of literals can't be enumerated up front and CSS can't
// measure luminance, so read the *computed* colour and re-light it in the same
// hue — the same approach the MyDict web reader uses for its entry iframe.
const TEXT_MIN_LUMINANCE = 0.45;
const TEXT_BOOST_LIGHTNESS = 66;
const BG_MAX_LUMINANCE = 0.75;
const BG_TAME_LIGHTNESS = 18;
/** Entries can hold tens of thousands of nodes; leave the tail alone. */
const SCAN_LIMIT = 5000;

const parseRgb = (value: string): [number, number, number] | null => {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const relativeLuminance = ([r, g, b]: [number, number, number]): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * `hsl(from …)` is relative colour syntax; browsers without it just skip the
 * whole pass rather than getting an invalid declaration.
 */
const supportsRelativeColor = (): boolean =>
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('color', 'hsl(from red h s 50%)');

const adaptToDarkTheme = (root: HTMLElement): void => {
  if (!supportsRelativeColor()) return;
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('*')).slice(0, SCAN_LIMIT);

  for (const el of nodes) {
    const rgb = parseRgb(getComputedStyle(el).color);
    if (!rgb || relativeLuminance(rgb) >= TEXT_MIN_LUMINANCE) continue;
    // Grey text has no hue to keep — hand it back to the theme foreground
    // instead of inventing a tint.
    el.style.color =
      rgb[0] === rgb[1] && rgb[1] === rgb[2]
        ? 'inherit'
        : `hsl(from rgb(${rgb.join(',')}) h s ${TEXT_BOOST_LIGHTNESS}%)`;
  }

  for (const el of nodes) {
    const rgb = parseRgb(getComputedStyle(el).backgroundColor);
    // Transparent reads as 0,0,0 and is therefore never "too bright".
    if (!rgb || relativeLuminance(rgb) <= BG_MAX_LUMINANCE) continue;
    el.style.backgroundColor = `hsl(from rgb(${rgb.join(',')}) h s ${BG_TAME_LIGHTNESS}%)`;
  }
};

/* ------------------------------------------------------------- renderer */

/**
 * Render MyDict-API results (shared by the built-in MyBooks dictionary and
 * user-added MyDict servers).
 *
 * Entries are grouped by dictionary and each group is a native `<details>`
 * with the first one open: a single lookup can hit several dictionaries, and
 * a 搜韵-style entry can hold dozens of homographs, so showing everything
 * expanded at once buries the word the reader actually wanted.
 *
 * The markup goes into a shadow root — the entries bring their own CSS, and
 * that must not apply to the reader chrome (nor the chrome's styles to them).
 */
export const renderMyBooksResults = (
  results: MyDictResult[],
  container: HTMLElement,
  options: MyBooksRenderOptions,
): void => {
  const translate = options._ ?? ((key: string) => key);

  const shadowHost = document.createElement('div');
  shadowHost.className = 'dict-shadow-host mt-1 text-sm';
  container.appendChild(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BASELINE_CSS;
  shadow.appendChild(style);

  // `part="dict-content"` is the only hook that reaches across the shadow
  // boundary, so the popup's font-size rule can scale entries (#4443).
  const body = document.createElement('div');
  body.setAttribute('part', 'dict-content');
  shadow.appendChild(body);

  // Entry stylesheets, deduped — every entry of a dictionary links the same
  // CSS file, and a group can hold dozens of entries.
  const pendingStyles: (HTMLLinkElement | HTMLStyleElement)[] = [];
  const seenStyles = new Set<string>();
  const collectStyles = (html: string): void => {
    for (const node of extractEntryStyles(html)) {
      const key =
        node instanceof HTMLLinkElement
          ? `link:${node.getAttribute('href')}`
          : `css:${node.textContent}`;
      if (seenStyles.has(key)) continue;
      seenStyles.add(key);
      pendingStyles.push(node);
    }
  };

  // The server orders hits by dictionary, so folding runs of the same name
  // preserves that order without a lookup table.
  const groups: { name: string; lang: string; items: MyDictResult[] }[] = [];
  for (const result of results) {
    const name = result.dictionary_name || '';
    const lang = langBucket(result.lang_from);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(result);
    else groups.push({ name, lang, items: [result] });
  }

  // CJK 输入在 all_langs 模式下会同时带回中日两侧的命中——语言标签让用户可以
  // 按语言聚焦。只有一种语言时不渲染。
  const langOrder: string[] = [];
  for (const group of groups) {
    if (!langOrder.includes(group.lang)) langOrder.push(group.lang);
  }
  // 默认聚焦与书内容语言一致的组：读日文书时查汉字词，日文词典才是第一顺位。
  // 书语言没有命中时回退「全部」。
  const bookLang = langBucket(options.lang);
  const defaultTab = langOrder.includes(bookLang) ? bookLang : '';

  let langTabs: HTMLDivElement | null = null;
  if (langOrder.length > 1) {
    langTabs = document.createElement('div');
    langTabs.className = 'mydict-lang-tabs';
    langTabs.addEventListener('click', (event) => event.stopPropagation());
    const mkTab = (lang: string, label: string) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'mydict-lang-tab' + (lang === defaultTab ? ' active' : '');
      tab.dataset['lang'] = lang;
      tab.textContent = label;
      tab.addEventListener('click', () => {
        for (const t of [...langTabs!.children]) t.classList.toggle('active', t === tab);
        for (const det of body.querySelectorAll('details')) {
          det.hidden = lang !== '' && det.dataset['lang'] !== lang;
        }
      });
      return tab;
    };
    langTabs.appendChild(mkTab('', translate('All')));
    for (const lang of langOrder) {
      langTabs.appendChild(mkTab(lang, LANG_TAB_NAMES[lang] ?? lang));
    }
  }

  groups.forEach((group, groupIndex) => {
    const details = document.createElement('details');
    details.className = 'mydict-group';
    details.dataset['lang'] = group.lang;
    // 默认聚焦书语言组时，其余语言整组隐藏（点标签再展开）。
    details.hidden = defaultTab !== '' && group.lang !== defaultTab;
    details.open = groupIndex === 0 && (defaultTab === '' || group.lang === defaultTab);

    const summary = document.createElement('summary');
    summary.className = 'mydict-group-head';
    const chevron = document.createElement('span');
    chevron.className = 'mydict-group-chevron';
    summary.appendChild(chevron);
    const nameEl = document.createElement('span');
    nameEl.className = 'mydict-group-name';
    nameEl.textContent = group.name;
    summary.appendChild(nameEl);

    // The card around this content toggles itself on any click that isn't an
    // `A`/`BUTTON`/`IMG` (DictionaryResultsView), so opening a group would also
    // fold the whole card away — clipped to `max-h-40`, that reads as "the
    // panel collapsed and I can't see anything". Keep the click local.
    summary.addEventListener('click', (event) => event.stopPropagation());

    if (group.items.length > 1) {
      const count = document.createElement('span');
      count.className = 'mydict-group-count';
      count.textContent = String(group.items.length);
      summary.appendChild(count);
    }

    // A hit from a dictionary whose language direction doesn't match came from
    // the server's cross-language fallback — say so, since import-time
    // detection can be wrong.
    if (group.items.every((item) => item.lang_match === false)) {
      const badge = document.createElement('span');
      badge.className = 'mydict-lang-badge';
      badge.textContent = translate('Other language');
      summary.appendChild(badge);
    }

    details.appendChild(summary);

    const groupBody = document.createElement('div');
    groupBody.className = 'mydict-group-body';
    const multiple = group.items.length > 1;
    group.items.forEach((item, itemIndex) => {
      const section = document.createElement('section');
      section.className = 'mydict-entry';

      // A header is only worth it when one dictionary returns several entries
      // for the word (the 搜韵 case): the ordinal is what tells them apart. A
      // lone entry almost always opens with its own headword — 汉典 starts
      // "天性 天性拼音：…" — so repeating it here would just print it twice.
      if (multiple) {
        const head = document.createElement('div');
        head.className = 'mydict-entry-head';
        const index = document.createElement('span');
        index.className = 'mydict-entry-index';
        index.textContent = `${itemIndex + 1}/${group.items.length}`;
        head.appendChild(index);
        if (item.word) {
          const word = document.createElement('span');
          word.className = 'mydict-entry-word';
          word.textContent = item.word;
          head.appendChild(word);
        }
        if (item.phonetic) {
          const phonetic = document.createElement('span');
          phonetic.className = 'mydict-entry-phonetic';
          phonetic.textContent = item.phonetic;
          head.appendChild(phonetic);
        }
        section.appendChild(head);
      }

      const content = document.createElement('div');
      content.className = 'mydict-entry-body';
      const definition = item.definition ?? '';
      // The entry's own stylesheets go to the shadow root below; the rest of
      // the markup goes through the sanitizer. `innerHTML` never executes a
      // `<script>` — `sanitizeDictionaryHtml` covers the rest (handlers,
      // iframes, `javascript:` URLs).
      collectStyles(definition);
      content.innerHTML = sanitizeDictionaryHtml(definition);
      section.appendChild(content);

      groupBody.appendChild(section);
    });
    details.appendChild(groupBody);
    body.appendChild(details);
  });

  // A dictionary's CSS is referenced by every one of its entries, so mount each
  // sheet once. Inserting before `body` keeps the cascade readable: baseline,
  // then the dictionaries' own rules, then the content they style.
  for (const node of pendingStyles) shadow.insertBefore(node, body);
  if (langTabs) shadow.insertBefore(langTabs, body);

  absolutizeResourceRefs(shadow, options.baseUrl);
  wireDictAudio(body, (resourcePath) => buildMyDictResourceUrl(options.baseUrl, resourcePath));
  wireLinks(body, options.onNavigate);
  if (options.isDarkMode) adaptToDarkTheme(body);
};

export const myBooksDictProvider: DictionaryProvider = {
  id: BUILTIN_PROVIDER_IDS.myBooks,
  kind: 'builtin',
  label: _('MyBooks Dictionary'),
  async lookup(word, ctx): Promise<DictionaryLookupOutcome> {
    const trimmed = word.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    try {
      const data = await queryMyDict(
        { url: MYBOOKS_DICT_URL, token: MYBOOKS_DICT_TOKEN },
        trimmed,
        ctx.signal,
      );
      if (ctx.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
      if (!data.results || data.results.length === 0) {
        return { ok: false, reason: 'empty' };
      }

      renderMyBooksResults(data.results, ctx.container, {
        baseUrl: MYBOOKS_DICT_URL,
        onNavigate: ctx.onNavigate,
        _: ctx._,
        lang: ctx.lang,
        isDarkMode: ctx.isDarkMode,
      });

      return { ok: true, headword: trimmed, sourceLabel: 'MyBooks' };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        return { ok: false, reason: 'error', message: 'aborted' };
      }
      console.error('MyBooks dictionary lookup failed', error);
      return {
        ok: false,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
