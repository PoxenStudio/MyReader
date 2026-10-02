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
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { sanitizeDictionaryHtml } from '@/utils/sanitize';
import { BUILTIN_PROVIDER_IDS } from '../types';
import type {
  DictionaryLookupOutcome,
  DictionaryProvider,
  VocabCapability,
  VocabResult,
} from '../types';
import { queryMyDict, type MyDictResult } from './myDictQuery';
import { buildMyDictResourceUrl } from './myDictUrl';
import { AUDIO_BOUND, wireDictAudio } from '../dictAudio';
import { wireEntryImageInteractions } from './dictEntryImages';

// Rendered through `translate` (the popup's `_`), which i18next-scanner can't
// see; declared here so extraction keeps these keys.
_('Other language');
_('Pronunciation playback failed: {{message}}');
_('Add to Wordbook');
_('Remove from Wordbook');
_('Add to Wordbook ({{source}})');
_('Remove from Wordbook ({{source}})');
_('Added to Wordbook ({{source}})');
_('Removed from Wordbook ({{source}})');
_('Already in Wordbook');
_('Wordbook unavailable, check the MyDict token');

const MYBOOKS_DICT_URL = 'https://mybooks.top/dict';

// Token issued by the MyBooks dictionary service (used for rate limiting).
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
  _?: (key: string, options?: Record<string, number | string>) => string;
  /** The book's content language (e.g. 'ja'); the language tabs default to it. */
  lang?: string;
  isDarkMode?: boolean;
  /** 该 provider 服务器的生词本；给了就在每个词典分组头渲染星标。 */
  vocab?: VocabCapability;
}

/** Root-relative prefix the server puts on entry resources. */
const RESOURCE_PREFIX = '/dict-res/';
/** MDict cross-reference scheme, left intact by the server on purpose. */
const ENTRY_LINK_PREFIX = 'entry://';

/**
 * Coarse language bucket for a language code (zh-Hans/zh-Hant both land on
 * `zh` — the dictionaries render their own variants). Handles both ISO 639-1
 * (`ja`) and 639-2/B (`jpn`) — Calibre stores the three-letter code, and the
 * reader popup passes it through as-is.
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
// Stand-ins for what a dictionary's own script would do (entry scripts never
// run here). One rule per dictionary, named after it.
const DICTIONARY_COMPAT_CSS = `
  /* The little dict (fy.js): shows the icon of each .pf link its CSS made visible. */
  .pf > a > img { display: inline-block !important; }
`;

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
  /* Pronunciation failure note: a failure anywhere in the playback chain
     (fetch / decode / autoplay policy) must not be silent — otherwise the user
     only sees "no sound" with nothing to report. */
  .mydict-audio-note {
    margin-top: 0.4em;
    font-size: 0.78em;
    color: color-mix(in srgb, currentColor 60%, #d64545);
  }
`;

/**
 * Everything the renderer owns but lives OUTSIDE the shadow scopes — language
 * tabs, the per-dictionary `<details>`/`<summary>` collapse chrome — plus the
 * styling they need, injected once into the light DOM.
 *
 * Why `<details>` lives in the light DOM: dictionary CSS uses bare element
 * selectors (OALD10's oald10.css has `details { display: inline-block }` and
 * `details[open] > summary > span { display: none }` — its own pages use
 * details as fold boxes). Left inside the shadow root, the folding structure
 * would be re-laid-out by the injected dictionary CSS and the whole group
 * would break. In the light DOM, dictionary styles (inside the shadow) can
 * never reach it.
 */
const DICT_CHROME_CSS = `
  details.mydict-group[hidden] { display: none !important; }
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
  details[open] > summary .mydict-group-chevron {
    transform: rotate(90deg);
  }
  summary.mydict-group-head:hover { color: color-mix(in srgb, currentColor 75%, transparent); }
  summary.mydict-group-head:hover .mydict-group-chevron { opacity: 0.8; }
  .mydict-group-name { font-weight: 600; }
  /* 生词本星标：每个词典分组一个，状态以服务端为准（★ 已收藏 / ☆ 未收藏） */
  .mydict-vocab-star {
    flex: none;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 1em;
    line-height: 1;
    padding: 0 0.15em;
    opacity: 0.55;
  }
  .mydict-vocab-star:hover { opacity: 1; }
  .mydict-vocab-star.saved { color: #d9a400; opacity: 1; }
  .mydict-vocab-star[disabled] { cursor: progress; opacity: 0.4; }
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
  .mydict-lang-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
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
  .mydict-lang-tab-active {
    background: color-mix(in srgb, currentColor 12%, transparent);
    opacity: 1;
  }
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
 * Must run before the nodes are connected: the browser starts fetching as soon
 * as they are, and a root-relative URL would hit the reader's own origin.
 */
const resolveResourceRef = (raw: string, baseUrl: string): string =>
  baseUrl.trim() && raw.startsWith(RESOURCE_PREFIX) ? buildMyDictResourceUrl(baseUrl, raw) : raw;

const absolutizeResourceRefs = (root: ParentNode, baseUrl: string): void => {
  if (!baseUrl.trim()) return;
  const selector = 'img[src], audio[src], video[src], source[src], track[src], a[href], link[href]';
  root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : 'href';
    const raw = el.getAttribute(attr);
    if (raw) el.setAttribute(attr, resolveResourceRef(raw, baseUrl));
  });
};

/**
 * 分组头里的生词本星标——每个词典分组一个。生词本是**词条级**的
 * （`(词典, 词头)` 一条），所以「存哪部词典的释义」由用户点哪个星标决定，而不是系统
 * 替他挑一条（中文词典的『人気』与 NHK 的『人気』可以并存）。
 *
 * 状态以服务端为准：挂载时查一次（`listSaved`），每次增删后再对账，所以别的设备上的
 * 改动也能自愈。点击不冒泡——分组头在结果卡片里，冒泡会把卡片折叠掉。
 */
const attachVocabStar = (summary: HTMLElement, options: VocabOptions): void => {
  const { capability, dictionaryId, word, savedFor, translate } = options;
  const source = { source: capability.label };
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mydict-vocab-star';
  let itemId: number | null = null;
  let busy = false;

  const render = (): void => {
    const saved = itemId !== null;
    button.textContent = saved ? '★' : '☆';
    button.classList.toggle('saved', saved);
    button.disabled = busy;
    button.setAttribute(
      'aria-label',
      saved ? translate('Remove from Wordbook') : translate('Add to Wordbook'),
    );
    button.title = saved
      ? translate('Remove from Wordbook ({{source}})', source)
      : translate('Add to Wordbook ({{source}})', source);
  };

  const notify = (type: 'success' | 'warning' | 'error', message: string): void => {
    eventDispatcher.dispatch('toast', { type, timeout: 4000, message });
  };

  const reportFailure = (result: VocabResult): void => {
    if (result.status === 'duplicate') {
      notify('warning', result.message ?? translate('Already in Wordbook'));
    } else if (result.status === 'unauthorized') {
      notify('error', translate('Wordbook unavailable, check the MyDict token'));
    } else if (result.status === 'error') {
      notify('error', result.message);
    }
  };

  /** 与服务端对账，拿到该词在这部词典里的条目 id（增删后也靠它收敛）。 */
  const sync = async (saved: Promise<Map<number, number>>): Promise<void> => {
    try {
      itemId = (await saved).get(dictionaryId) ?? null;
    } catch {
      itemId = null;
    }
    render();
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    busy = true;
    render();
    void (async () => {
      try {
        if (itemId === null) {
          const result = await capability.addEntry({ dictionaryId, word });
          if (result.status === 'ok') {
            notify('success', translate('Added to Wordbook ({{source}})', source));
          } else {
            reportFailure(result);
          }
        } else {
          const result = await capability.removeItem(itemId);
          if (result.status === 'ok') {
            notify('success', translate('Removed from Wordbook ({{source}})', source));
          } else {
            reportFailure(result);
          }
        }
        await sync(capability.listSaved(word));
      } finally {
        busy = false;
        render();
      }
    })();
  });

  render();
  void sync(savedFor(word));
  summary.appendChild(button);
};

/** {@link attachVocabStar} needs. */
interface VocabOptions {
  capability: VocabCapability;
  dictionaryId: number;
  word: string;
  /** Saved set shared by the groups of one render, so a headword is fetched once. */
  savedFor: (word: string) => Promise<Map<number, number>>;
  translate: (key: string, vars?: Record<string, number | string>) => string;
}

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

const extractEntryStyles = (
  html: string,
  baseUrl: string,
): (HTMLLinkElement | HTMLStyleElement)[] => {
  const nodes: (HTMLLinkElement | HTMLStyleElement)[] = [];

  for (const match of html.matchAll(STYLE_LINK_RE)) {
    if (nodes.length >= MAX_ENTRY_STYLES) break;
    if (!/stylesheet/i.test(attrValue(match[0], REL_ATTR_RE) ?? '')) continue;
    const href = attrValue(match[0], HREF_ATTR_RE);
    if (!href) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', resolveResourceRef(href, baseUrl));
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
    if (anchor.dataset[AUDIO_BOUND]) return; // pronunciation click already owned by dictAudio
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith(ENTRY_LINK_PREFIX)) {
      if (!onNavigate) return;
      // Targets may be percent-encoded (Weblio-family dictionaries:
      // `entry://%E5%BA%83%E3%81%8F`) — undecoded, we'd look up `%E5%BA%83…`;
      // Oxford-family ones carry an anchor (`entry://dirty_1#down_idmg_5`)
      // that no headword matches. Both showed up as "broken jumps". Decode,
      // then strip the anchor, and look up the real headword.
      const rawWord = href.slice(ENTRY_LINK_PREFIX.length);
      let word = rawWord;
      try {
        word = decodeURIComponent(rawWord);
      } catch {
        // Malformed percent sequence (a bare % in the name): use it as-is.
      }
      word = word.split('#')[0]!.trim();
      if (!word) return;
      anchor.addEventListener('click', (event) => {
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
 * Hits are grouped by dictionary and **each dictionary gets its own shadow
 * scope**: dictionaries style bare elements (`div`, `li { float: left }`,
 * `table { … }`) and a shared shadow lets 千篇's rules reflow the English
 * dictionary's lists. Per-scope isolation costs one extra shadow per
 * dictionary and buys exact containment.
 *
 * Each dictionary folds into a native `<details>` that wraps its scope (first
 * one open); with several
 * languages hit, a language tab strip (全部 / 中文 / 日本語 …) sits above
 * them — a single lookup can hit a dozen dictionaries, and the reader's own
 * language picks the default tab. `entry://word` cross-references follow the
 * shell's `onNavigate`; hits the server only matched after falling back to
 * another language (`lang_match`) are marked in the strip.
 */
export const renderMyBooksResults = (
  results: MyDictResult[],
  container: HTMLElement,
  options: MyBooksRenderOptions,
): void => {
  const translate =
    options._ ??
    ((key: string, vars?: Record<string, number | string>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars?.[name] ?? '')));

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

  const langOrder: string[] = [];
  for (const group of groups) {
    if (!langOrder.includes(group.lang)) langOrder.push(group.lang);
  }
  // Default to the group matching the book's language: looking up a kanji
  // word in a Japanese book, the Japanese dictionaries come first. Fall back
  // to "All" when the book's language has no hits.
  const bookLang = langBucket(options.lang);
  const activeLang = langOrder.includes(bookLang) ? bookLang : '';

  const savedByWord = new Map<string, Promise<Map<number, number>>>();
  const savedFor = (word: string): Promise<Map<number, number>> => {
    let saved = savedByWord.get(word);
    if (!saved) {
      saved = options.vocab?.listSaved(word) ?? Promise.resolve(new Map<number, number>());
      savedByWord.set(word, saved);
    }
    return saved;
  };

  /** On any tab other than "All", groups in other languages are hidden. */
  const scopes: { det: HTMLDetailsElement; lang: string }[] = [];
  let openedVisibleGroup = false;
  const applyLangFilter = (lang: string): void => {
    for (const scope of scopes) {
      scope.det.style.display = lang !== '' && scope.lang !== lang ? 'none' : '';
    }
  };

  // The folding chrome and language tabs live in the light DOM, so their
  // styles are injected once here (BASELINE_CSS inside each shadow can't reach
  // them, and entry CSS inside the shadow must not reach our skeleton).
  const chromeCss = document.createElement('style');
  chromeCss.textContent = DICT_CHROME_CSS;
  container.appendChild(chromeCss);

  // Language tab strip (rendered only with two or more languages).
  if (langOrder.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'mydict-lang-tabs flex flex-wrap items-center gap-1.5';
    tabs.addEventListener('click', (event) => event.stopPropagation());
    const mkTab = (lang: string, label: string) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = label;
      tab.className = 'mydict-lang-tab' + (lang === activeLang ? ' mydict-lang-tab-active' : '');
      tab.addEventListener('click', () => {
        for (const t of [...tabs.children]) t.classList.toggle('mydict-lang-tab-active', t === tab);
        applyLangFilter(lang);
      });
      return tab;
    };
    tabs.appendChild(mkTab('', translate('All')));
    for (const lang of langOrder) {
      tabs.appendChild(mkTab(lang, LANG_TAB_NAMES[lang] ?? lang));
    }
    container.appendChild(tabs);
  }

  for (const group of groups) {
    // One native `<details>` per dictionary: a group can hold dozens of
    // homographs (搜韵), and expanding them all would bury the word the reader
    // is after. Only the first group starts open.
    const details = document.createElement('details');
    details.className = 'mydict-group';
    details.dataset['lang'] = group.lang;
    container.appendChild(details);

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

    // 生词本星标：词条级生词本按 (词典, 词头) 定位，所以发该组首条命中的 word，
    // 而不是读者的选区原文（MyDict 是前缀匹配，选区可能不是词头）。
    const firstHit = group.items[0];
    if (options.vocab && firstHit && typeof firstHit.dictionary_id === 'number' && firstHit.word) {
      attachVocabStar(summary, {
        capability: options.vocab,
        dictionaryId: firstHit.dictionary_id,
        word: firstHit.word,
        savedFor,
        translate,
      });
    }

    details.appendChild(summary);

    const scopeHost = document.createElement('div');
    scopeHost.className = 'dict-shadow-host mydict-scope mt-1 text-sm';
    details.appendChild(scopeHost);
    const shadow = scopeHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = BASELINE_CSS + DICTIONARY_COMPAT_CSS;
    shadow.appendChild(style);

    // The dictionary's own stylesheets (DOMPurify drops <link>/<style>
    // unconditionally, so they are re-attached here one by one). Mounted in
    // this group's own scope, they can't leak into other dictionaries or reach
    // the light-DOM folding skeleton.
    const dictStyles: (HTMLLinkElement | HTMLStyleElement)[] = [];
    const seenStyles = new Set<string>();
    for (const item of group.items) {
      for (const node of extractEntryStyles(item.definition ?? '', options.baseUrl)) {
        const key =
          node instanceof HTMLLinkElement
            ? `link:${node.getAttribute('href')}`
            : `css:${node.textContent}`;
        if (seenStyles.has(key)) continue;
        seenStyles.add(key);
        dictStyles.push(node);
      }
    }
    for (const node of dictStyles) shadow.appendChild(node);

    // `part="dict-content"` is the only hook that reaches across the shadow
    // boundary, so the popup's font-size rule can scale entries (#4443).
    const body = document.createElement('div');
    body.setAttribute('part', 'dict-content');
    shadow.appendChild(body);

    const multiple = group.items.length > 1;
    let entryIndex = 0;
    for (const item of group.items) {
      entryIndex += 1;
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
        index.textContent = `${entryIndex}/${group.items.length}`;
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
      // The entry's own stylesheets go to this scope above; the rest of the
      // markup goes through the sanitizer. `innerHTML` never executes a
      // `<script>` — `sanitizeDictionaryHtml` covers the rest (handlers,
      // iframes, `javascript:` URLs).
      // Parsed in an inert <template> so nothing loads before URLs are re-anchored.
      const template = document.createElement('template');
      template.innerHTML = sanitizeDictionaryHtml(definition);
      absolutizeResourceRefs(template.content, options.baseUrl);
      content.appendChild(template.content);
      section.appendChild(content);

      body.appendChild(section);
    }

    // Re-anchor the server's root-relative `/dict-res/<id>/res/…` references to
    // the server they came from (via the relay on the web build), then wire
    // up the in-entry link behaviour.
    const audioNote = document.createElement('div');
    audioNote.className = 'mydict-audio-note';
    audioNote.hidden = true;
    body.appendChild(audioNote);
    wireDictAudio(
      body,
      (resourcePath) => buildMyDictResourceUrl(options.baseUrl, resourcePath),
      (message) => {
        audioNote.textContent = translate('Pronunciation playback failed: {{message}}', {
          message,
        });
        audioNote.hidden = false;
      },
      () => {
        audioNote.hidden = true;
      },
    );
    wireLinks(body, options.onNavigate);
    // 词条图片交互（牛津拓展图原地展开、扫描版大图幻灯片）：从扩展移植回来。
    wireEntryImageInteractions(body);
    if (options.isDarkMode) adaptToDarkTheme(body);

    // Initial visibility follows the default tab; only the first group visible
    // under it starts expanded.
    const visible = activeLang === '' || group.lang === activeLang;
    details.style.display = visible ? '' : 'none';
    details.open = visible && !openedVisibleGroup;
    if (visible) openedVisibleGroup = true;
    scopes.push({ det: details, lang: group.lang });
  }
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
