import type { Transformer } from './types';

// Books that ship LaTeX instead of MathML spell formulas with delimiters in the
// running text. `$$…$$`, `\[…\]` and `\(…\)` are unambiguous; a bare `$…$` is
// not — books about shell scripts, prices or currency use `$` as ordinary text —
// so inline dollars are only honored when the content passes `looksLikeTex`.
const DELIMITERS = [
  { open: '$$', close: '$$', displayMode: true },
  { open: '\\[', close: '\\]', displayMode: true },
  { open: '\\(', close: '\\)', displayMode: false },
  { open: '$', close: '$', displayMode: false },
] as const;

const MAYBE_TEX_RE = /\\\(|\\\[|\$/;

// A `$…$` run longer than this is prose that happens to contain two dollars.
const MAX_INLINE_DOLLAR_LENGTH = 400;

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const XML_DECL_RE = /^\s*<\?xml[^?]*\?>/;

// Verbatim content, and anything already inside a MathML rendering — rewriting
// math the engine can lay out natively would only lose information.
const SKIP_TAGS = new Set([
  'pre',
  'code',
  'kbd',
  'samp',
  'script',
  'style',
  'textarea',
  'annotation',
  'annotation-xml',
]);

let katexModule: Promise<typeof import('katex')> | null = null;

type Katex = typeof import('katex').default;

const loadKatex = async () => {
  katexModule ??= import('katex');
  return (await katexModule).default;
};

type TexMatch = { start: number; end: number; tex: string; displayMode: boolean };

// Signals that a `$…$` run is TeX rather than prose: a command, a script, a
// brace, an operator, or a single symbol (`$x$`).
const looksLikeTex = (tex: string): boolean => /[\\^_{}=+<>/]|^.$/.test(tex);

// Finds the next TeX run at or after `from`. A run that fails its guards is
// skipped by resuming the search just past the opening delimiter, so a rejected
// `$` can still pair with a later one (`$PATH … $x$`).
const findTex = (
  text: string,
  from: number,
): { match: TexMatch } | { nextIndex: number } | null => {
  let best: { pos: number; delimiter: (typeof DELIMITERS)[number] } | null = null;
  for (const delimiter of DELIMITERS) {
    const pos = text.indexOf(delimiter.open, from);
    if (pos < 0) continue;
    if (!best || pos < best.pos) best = { pos, delimiter };
  }
  if (!best) return null;

  const { pos, delimiter } = best;
  if (delimiter.open === '$' && (text[pos - 1] === '$' || text[pos + 1] === '$')) {
    return { nextIndex: pos + 1 };
  }

  const closeIndex = text.indexOf(delimiter.close, pos + delimiter.open.length);
  if (closeIndex < 0) return { nextIndex: pos + delimiter.open.length };

  const tex = text.slice(pos + delimiter.open.length, closeIndex).trim();
  if (!tex) return { nextIndex: pos + delimiter.open.length };

  if (delimiter.open === '$') {
    const run = text.slice(pos + delimiter.open.length, closeIndex);
    if (run.length > MAX_INLINE_DOLLAR_LENGTH) return { nextIndex: pos + 1 };
    if (/^\s|\s$/.test(run)) return { nextIndex: pos + 1 };
    if (!/[A-Za-z\\]/.test(tex)) return { nextIndex: pos + 1 };
    if (!looksLikeTex(tex)) return { nextIndex: pos + 1 };
    // `$5` followed by `$10` is a price range, not a formula.
    if (/\d/.test(text[closeIndex + 1] ?? '')) return { nextIndex: pos + 1 };
  }

  return {
    match: {
      start: pos,
      end: closeIndex + delimiter.close.length,
      tex,
      displayMode: delimiter.displayMode,
    },
  };
};

const scanTex = (text: string): TexMatch[] => {
  const matches: TexMatch[] = [];
  let index = 0;
  while (index < text.length) {
    const found = findTex(text, index);
    if (!found) break;
    if ('match' in found) {
      matches.push(found.match);
      index = found.match.end;
    } else {
      index = found.nextIndex;
    }
  }
  return matches;
};

const isSkipped = (node: Text): boolean => {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.namespaceURI === MATHML_NS) return true;
    if (SKIP_TAGS.has(el.localName.toLowerCase())) return true;
  }
  return false;
};

// KaTeX emits XHTML, and its MathML elements land in the MathML namespace, so
// the nodes can be imported into the section's XML document as-is.
const parseRenderedNodes = (doc: Document, holder: Document, html: string): Node[] => {
  holder.body.innerHTML = html;
  // The sanitizer that runs after this transformer treats <semantics> and
  // <annotation> as disallowed MathML: it unwraps them but keeps their text,
  // which would print the TeX source next to the formula it belongs to. Drop the
  // annotation here, and lift the presentation markup out of <semantics>.
  for (const annotation of Array.from(holder.body.querySelectorAll('annotation'))) {
    annotation.remove();
  }
  for (const semantics of Array.from(holder.body.querySelectorAll('semantics'))) {
    semantics.replaceWith(...Array.from(semantics.childNodes));
  }
  return Array.from(holder.body.childNodes).map((node) => doc.importNode(node, true));
};

const renderInTextNode = (doc: Document, holder: Document, node: Text, katex: Katex): number => {
  const matches = scanTex(node.data);
  if (matches.length === 0) return 0;

  const fragment = doc.createDocumentFragment();
  const text = node.data;
  let cursor = 0;
  let rendered = 0;

  for (const match of matches) {
    let html: string;
    try {
      html = katex.renderToString(match.tex, {
        displayMode: match.displayMode,
        // MathML only: the app renders MathML natively and loads no KaTeX
        // stylesheet, so the HTML half of the default output would draw the
        // formula twice (the note markdown renderer makes the same choice).
        output: 'mathml',
      });
    } catch {
      // A formula the engine cannot parse stays as the source text the book
      // wrote, rather than becoming an error box in the middle of a paragraph.
      continue;
    }
    if (cursor < match.start) {
      fragment.appendChild(doc.createTextNode(text.slice(cursor, match.start)));
    }
    for (const child of parseRenderedNodes(doc, holder, html)) fragment.appendChild(child);
    cursor = match.end;
    rendered += 1;
  }

  if (rendered === 0) return 0;
  if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
  node.replaceWith(fragment);
  return rendered;
};

const renderTexInDocument = (doc: Document, katex: Katex): number => {
  const root = doc.documentElement;
  if (!root) return 0;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!isSkipped(node)) textNodes.push(node);
  }

  const holder = new DOMParser().parseFromString('<body></body>', 'text/html');
  let rendered = 0;
  for (const node of textNodes) {
    rendered += renderInTextNode(doc, holder, node, katex);
  }
  return rendered;
};

export const latexTransformer: Transformer = {
  name: 'latex',

  transform: async (ctx) => {
    const content = ctx.content;
    if (!MAYBE_TEX_RE.test(content)) return content;

    // `&nbsp;` is an HTML entity, not XML: leaving it in makes the whole section
    // fail to parse, and no formula in it would render. The sanitizer normalizes
    // the same entity for the same reason, and turns the numeric reference back
    // into `&nbsp;` later.
    const doc = new DOMParser().parseFromString(
      content.replaceAll('&nbsp;', '&#160;'),
      'application/xhtml+xml',
    );
    // Malformed XHTML: foliate falls back to parsing it as HTML, and rewriting
    // a document we cannot round-trip would be a regression, so leave it be.
    if (doc.getElementsByTagName('parsererror').length > 0) return content;

    const katex = await loadKatex();
    if (renderTexInDocument(doc, katex) === 0) return content;

    const xmlDecl = XML_DECL_RE.exec(content)?.[0] ?? '';
    return xmlDecl + new XMLSerializer().serializeToString(doc);
  },
};
