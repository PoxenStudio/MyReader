import type { Transformer } from './types';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const XML_DECL_RE = /^\s*<\?xml[^?]*\?>/;

// `xmlns:foo="http://www.w3.org/1998/Math/MathML"` — some LaTeX → EPUB
// converters (pdf-craft's epub-generator among them) spell MathML with a
// namespace *prefix* instead of the default namespace: `<m:math xmlns:m="…">`
// rather than `<math xmlns="…">`.
//
// That spelling is valid XML, so validators and XML-based readers (calibre) are
// happy with it, but every stage of this app that hands book markup to an HTML
// parser — the DOMPurify sanitizer and foliate's `srcdoc` injection — matches
// tag names literally, so `m:math` is an unknown element: the wrappers are
// dropped and the formula collapses into running text (`x²+y²` renders as
// `x2+y2`, fractions and radicals lose their shape entirely).
//
// Rebuilding the elements without the prefix restores the canonical form the
// HTML parser maps onto the MathML namespace, which is what the engine lays out
// as math. Content without prefixed MathML (the vast majority of books) is
// returned untouched after a single regex test.
const MATHML_PREFIX_DECL_RE = new RegExp(
  `xmlns:[\\w.-]+\\s*=\\s*["']${MATHML_NS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`,
);

const normalizePrefixedMathML = (content: string): string => {
  if (!MATHML_PREFIX_DECL_RE.test(content)) return content;

  // `&nbsp;` is an HTML entity, not XML: leaving it in makes the whole section
  // fail to parse and skip the fix. The sanitizer normalizes the same entity for
  // the same reason, and turns the numeric reference back into `&nbsp;` later.
  const doc = new DOMParser().parseFromString(
    content.replaceAll('&nbsp;', '&#160;'),
    'application/xhtml+xml',
  );
  // Content that is not well-formed XHTML is left alone: the pipeline already
  // has a fallback for those books (foliate re-parses them as HTML), and
  // re-serializing a broken document would only make things worse.
  if (doc.getElementsByTagName('parsererror').length > 0) return content;

  const prefixed = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.namespaceURI === MATHML_NS && el.prefix,
  );
  if (prefixed.length === 0) return content;

  // Drop the prefix declarations themselves, wherever they sit — on <math> or on
  // an ancestor such as <html>. A declaration still in scope keeps the prefix
  // bound to the MathML namespace, and the serializer would happily re-use it for
  // the rebuilt elements, handing the HTML parser back the same `m:math` spelling
  // this transformer exists to remove.
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('xmlns:') && attr.value === MATHML_NS) el.removeAttribute(attr.name);
    }
  }

  for (const el of prefixed) {
    const replacement = doc.createElementNS(MATHML_NS, el.localName);
    for (const attr of Array.from(el.attributes)) {
      replacement.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    while (el.firstChild) replacement.appendChild(el.firstChild);
    el.replaceWith(replacement);
  }

  // XMLSerializer never writes the XML declaration, so put back the one the
  // section came with — both foliate and the sanitizer expect the XHTML shape.
  const xmlDecl = XML_DECL_RE.exec(content)?.[0] ?? '';
  return xmlDecl + new XMLSerializer().serializeToString(doc);
};

export const mathmlTransformer: Transformer = {
  name: 'mathml',

  // Not gated on `viewSettings.allowScript` like the sanitizer: skipping the
  // sanitizer still leaves foliate injecting the section through `srcdoc`,
  // which is parsed as HTML too, so prefixed MathML has to be normalized for
  // every book either way.
  transform: async (ctx) => normalizePrefixedMathML(ctx.content),
};
