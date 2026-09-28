import DOMPurify from 'dompurify';

export const sanitizeString = (str?: string) => {
  if (!str) return str;
  return str.replace(/\u0000/g, '');
};

/**
 * Strip untrusted HTML (Send-to-Readest email/web/DOCX conversion, OPDS feed
 * descriptions, etc.) down to safe, EPUB-appropriate structural markup. Removes
 * scripts, event handlers, styles, iframes, and form controls; keeps headings,
 * text, lists, tables, links and images.
 *
 * Runs against the real DOM, so callers must be on the client (browser or Tauri
 * webview), both of which provide `window`/`DOMParser`.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'blockquote',
      'pre',
      'code',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'del',
      'ins',
      'sup',
      'sub',
      'span',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'img',
      'figure',
      'figcaption',
      // Markdown footnote definitions arrive wrapped in <section class="footnotes">
      // (see utils/mdFootnotes.ts), which must survive to be found and re-emitted.
      'section',
    ],
    // `id` is allowed so heading anchors survive — the EPUB's nested
    // navMap uses `chapter1.xhtml#heading-id` to link the TOC sidebar to
    // each section. Without it readers see one entry per chapter only.
    // `class` is allowed so Markdown code fences keep their `language-*`
    // class for theming (see utils/md.ts).
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'id', 'class'],
    // Drop anything that would load or run remote code.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['srcset'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Strip scripts and event handlers from an untrusted *document* before it is
 * handed to `DOMParser`. Unlike `sanitizeHtml`, this keeps the document
 * structure (`<head>`, `<title>`, sectioning elements) so title extraction and
 * Readability still work — it only removes anything executable.
 */
export function sanitizeForParsing(html: string): string {
  return DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true });
}

/**
 * Tags an entry may never bring in, whatever else is allowed.
 *
 * `link`/`style` are here on purpose: DOMPurify drops them unconditionally
 * (they'd apply outside the sanitized subtree), so the renderer lifts the
 * entry's stylesheets out of the markup first and mounts them into the card's
 * shadow root itself. `script`/`iframe`/`object`/`embed` and the form controls
 * are the executable/interactive surface; the document-level tags (`html`,
 * `head`, `body`, `title`, `base`, `meta`) only appear when an entry ships a
 * whole document, and must not be re-nested. `xmp`/`plaintext` swallow every
 * following byte, and `<foreignObject>` re-opens HTML inside SVG.
 */
const FORBIDDEN_DICTIONARY_TAGS = [
  'script',
  'style',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'base',
  'meta',
  'html',
  'head',
  'body',
  'title',
  'template',
  'noscript',
  'xmp',
  'plaintext',
  'foreignObject',
];

const TAG_NAME_RE = /<\s*([a-zA-Z][a-zA-Z0-9:_-]*)/g;

/**
 * Dictionary-specific element names — `chn`, `o10`, `geo`, `sn`, … — that a
 * dictionary styles from its own CSS but that DOMPurify's allow-list has never
 * heard of. They are inert elements with no behaviour, so keeping them is what
 * preserves the dictionaries' typography (dropping them is why entries with
 * these tags looked unstructured). Anything forbidden stays forbidden:
 * DOMPurify checks `FORBID_TAGS` before the allow-list.
 */
const collectDictionaryTags = (html: string): string[] => {
  const forbidden = new Set(FORBIDDEN_DICTIONARY_TAGS.map((tag) => tag.toLowerCase()));
  const tags = new Set<string>();
  for (const match of html.matchAll(TAG_NAME_RE)) {
    const tag = match[1]!.toLowerCase();
    if (!forbidden.has(tag)) tags.add(tag);
  }
  return [...tags];
};

/**
 * Sanitize one entry served by a dictionary server (MyDict / MyBooks,
 * `GET /api/v1/query?full_style=true`) before it is injected into the
 * dictionary card's shadow root.
 *
 * Built on DOMPurify's own HTML allow-list plus the entry's custom elements,
 * rather than a hand-written list: dictionary markup spans thirty years of
 * HTML, and a curated list is how you silently lose `<font color>`, a table's
 * `bgcolor` or one dictionary's `chn` element. (The caller lifts `<link>`/
 * `<style>` out first — see {@link FORBIDDEN_DICTIONARY_TAGS}.)
 *
 * Nothing executable survives: scripts, iframes, objects, form controls and
 * `on*` handlers are all gone (handlers matter — `innerHTML` won't run a
 * `<script>`, but it will happily bind `onclick`).
 */
export function sanitizeDictionaryHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: collectDictionaryTags(html),
    FORBID_TAGS: FORBIDDEN_DICTIONARY_TAGS,
    // `srcset` would let a single tiny `<img>` fan out into many requests and
    // is not part of what the server rewrites, so drop it like the EPUB path
    // does.
    FORBID_ATTR: ['srcset'],
    // DOMPurify drops attributes whose URI scheme it doesn't recognise, which
    // would silently kill MDict's `entry://word` cross-references — the server
    // deliberately leaves those for the reader to intercept. This is its
    // default scheme list plus `entry`.
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|entry):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
