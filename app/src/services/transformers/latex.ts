import type { Transformer } from './types';
import { normalizeMathMl } from './mathmlNormalize';

// Books that ship LaTeX instead of MathML spell formulas in the running text.
// `$$…$$`, `\[…\]` and `\(…\)` are unambiguous; a bare `$…$` is not — books
// about shell scripts, prices or currency use `$` as ordinary text — so inline
// dollars are only honored when the content passes `looksLikeTex`. On top of
// those, a book exported straight from LaTeX may use `\begin{equation}…` with no
// delimiter at all, which is what `\begin{` covers here.
const DELIMITERS = [
  { open: '$$', close: '$$', displayMode: true },
  { open: '\\[', close: '\\]', displayMode: true },
  { open: '\\(', close: '\\)', displayMode: false },
  { open: '$', close: '$', displayMode: false },
] as const;

const MAYBE_TEX_RE = /\\\(|\\\[|\$|\\begin\{/;

// A `$…$` run longer than this is prose that happens to contain two dollars.
const MAX_INLINE_DOLLAR_LENGTH = 400;

// Books exported straight from LaTeX spell display math with an environment
// instead of a delimiter: `\begin{equation}…\end{equation}`, `\begin{align}…`,
// `\begin{gather}…`. KaTeX renders those, but *only* in display mode — it raises
// `{equation} can be used only in display mode` otherwise — so every
// environment match is rendered as display math.
//
// Which environments KaTeX knows is left to KaTeX: an environment it does not
// implement (`multline`, `eqnarray`, or something that is not math at all like
// `itemize`) makes `renderToString` throw, and the run is left as the source
// text the book wrote. Keeping a list here would only have to track KaTeX's own
// support table.
const ENV_OPEN = '\\begin{';
const ENV_CLOSE = '\\end{';

// A `\begin{` whose `\end{` is nowhere near is not a formula. The closing
// environment is already matched by name, so this guard only has to catch markup
// broken across a long stretch of text — it is not a statement about how long a
// formula may be, and it sits an order of magnitude above the longest display
// block a book realistically carries. What it stops is handing a whole section
// to KaTeX in one call.
//
// A run that trips it is kept as the source text the book wrote and the scan
// resumes *after* it, so one runaway cannot hide the formulas written later in
// the same text node (see `findEnv`).
const MAX_ENV_LENGTH = 20000;

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
// The `\end{<name>}` that closes the `\begin{<name>}` opened before `from`,
// counting every `\begin{` against every `\end{` so that a nested environment
// (`\begin{equation}\begin{aligned}…\end{aligned}\end{equation}`) closes its
// own pair. Returns the index of `\end{`, or -1 when it is never closed — or
// closed by a different environment, which means the markup is broken.
const findEnvClose = (text: string, from: number, name: string): number => {
  let depth = 0;
  let index = from;
  for (;;) {
    const openedAt = text.indexOf(ENV_OPEN, index);
    const closedAt = text.indexOf(ENV_CLOSE, index);
    if (closedAt < 0) return -1;
    if (openedAt >= 0 && openedAt < closedAt) {
      depth += 1;
      index = openedAt + ENV_OPEN.length;
      continue;
    }
    const brace = closedAt + ENV_CLOSE.length;
    const closingBrace = text.indexOf('}', brace);
    if (closingBrace < 0) return -1;
    if (depth > 0) {
      depth -= 1;
      index = closingBrace + 1;
      continue;
    }
    return text.slice(brace, closingBrace).trim() === name ? closedAt : -1;
  }
};

// What looking for an environment turned up: the environment itself, a position
// to resume from when the `\begin{` found there is not a formula after all, or
// `null` when there is no `\begin{` left in the text.
type EnvSearch = { match: TexMatch } | { nextIndex: number } | null;

const findEnv = (text: string, from: number): EnvSearch => {
  const start = text.indexOf(ENV_OPEN, from);
  if (start < 0) return null;

  // Every rejection below resumes just past the `\begin{` it rejected instead of
  // reporting "no environment here". Returning `null` ends the scan, so a text
  // node that opens with a broken or unusable environment would lose every
  // formula written after it.
  const skipOpener = { nextIndex: start + ENV_OPEN.length };

  const nameStart = start + ENV_OPEN.length;
  const nameEnd = text.indexOf('}', nameStart);
  if (nameEnd < 0) return skipOpener;
  const name = text.slice(nameStart, nameEnd).trim();
  if (!name) return skipOpener;

  const closedAt = findEnvClose(text, nameEnd + 1, name);
  if (closedAt < 0) return skipOpener;
  const end = text.indexOf('}', closedAt + ENV_CLOSE.length) + 1;
  if (end <= 0) return skipOpener;

  const tex = text.slice(start, end).trim();
  // Past the runaway guard: keep the whole run as the source text the book wrote
  // and resume after it rather than inside it — resuming inside would render the
  // nested environments of a block just decided against.
  if (tex.length > MAX_ENV_LENGTH) return { nextIndex: end };
  return { match: { start, end, tex, displayMode: true } };
};

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

  // An environment starting before the next delimiter wins; one starting after
  // it is either part of that formula or found again further along.
  const env = findEnv(text, from);
  if (env && 'match' in env && (!best || env.match.start < best.pos)) {
    return { match: env.match };
  }

  // No delimiter left to render, but a rejected `\begin{` still has to be
  // stepped over: the scan ends as soon as this returns `null`, so one unusable
  // environment would take the rest of the text node with it. `env` here is
  // either that resume position or `null`.
  if (!best) return env;

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
  // KaTeX wraps its MathML in the same `<semantics>` / `<annotation>` scaffolding
  // books ship, so it is reduced by the very same helper the `mathml` transformer
  // applies to book markup. The sanitizer that runs after this transformer treats
  // both elements as disallowed MathML: it unwraps them but keeps their text,
  // which would print the TeX source next to the formula it belongs to.
  normalizeMathMl(holder.body);
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
