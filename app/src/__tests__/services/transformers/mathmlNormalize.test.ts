import { describe, test, expect } from 'vitest';
import { normalizeMathMl } from '@/services/transformers/mathmlNormalize';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

// The book path: sections arrive as XHTML, so the transformer parses them as XML.
const parseXml = (inner: string) =>
  new DOMParser().parseFromString(
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${inner}</body></html>`,
    'application/xhtml+xml',
  );

// The KaTeX path: rendered MathML is dropped into an HTML holder document.
const parseHtml = (inner: string) =>
  new DOMParser().parseFromString(`<body>${inner}</body>`, 'text/html');

const math = (inner: string) => `<math xmlns="${MATHML_NS}">${inner}</math>`;

const run = (parse: (inner: string) => Document, inner: string) => {
  const doc = parse(inner);
  const changed = normalizeMathMl(doc);
  return { changed, doc };
};

describe('normalizeMathMl', () => {
  describe('<semantics>', () => {
    test('reduces to the first renderable child and drops the annotation', () => {
      const { changed, doc } = run(
        parseXml,
        math(
          `<semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow>` +
            `<annotation encoding="application/x-tex">x^{2}</annotation></semantics>`,
        ),
      );

      expect(doc.querySelector('semantics')).toBeNull();
      expect(doc.querySelector('annotation')).toBeNull();
      // The presentation markup took the <semantics>' position.
      const mrow = doc.querySelector('math > mrow');
      expect(mrow).not.toBeNull();
      expect(mrow!.namespaceURI).toBe(MATHML_NS);
      // The TeX fallback is gone, so it cannot be printed beside the formula.
      expect(doc.body.textContent).toBe('x2');
      expect(changed).toBe(2);
    });

    test('keeps what a renderer would have shown and discards the rest', () => {
      const { doc } = run(parseXml, math(`<semantics><mi>a</mi><mi>b</mi><mi>c</mi></semantics>`));

      // A renderer uses the first child it can lay out and ignores the others.
      expect(doc.body.textContent).toBe('a');
    });

    test('drops a <semantics> that has no element child left', () => {
      const { doc } = run(
        parseXml,
        math(`<semantics><annotation encoding="application/x-tex">x</annotation></semantics>`),
      );

      expect(doc.querySelector('semantics')).toBeNull();
      expect(doc.querySelector('math')!.children).toHaveLength(0);
      expect(doc.body.textContent).toBe('');
    });

    test('handles nesting inside an <mrow>', () => {
      const { doc } = run(
        parseXml,
        math(
          `<semantics><mrow><mi>a</mi>` +
            `<semantics><mi>b</mi><annotation>b</annotation></semantics>` +
            `</mrow></semantics>`,
        ),
      );

      expect(doc.querySelector('semantics')).toBeNull();
      expect(doc.querySelector('annotation')).toBeNull();
      expect(doc.body.textContent).toBe('ab');
    });

    test('reduces MathML rendered into an HTML holder too', () => {
      const { doc } = run(
        parseHtml,
        math(`<semantics><mrow><mi>a</mi></mrow><annotation>a</annotation></semantics>`),
      );

      expect(doc.querySelector('semantics')).toBeNull();
      expect(doc.querySelector('annotation')).toBeNull();
      expect(doc.body.textContent).toBe('a');
    });
  });

  describe('<annotation-xml>', () => {
    const wrap = (annotationXml: string) =>
      math(`<semantics><mrow><mi>a</mi></mrow>${annotationXml}</semantics>`);

    test.each([
      'application/xhtml+xml',
      'text/html',
      '',
    ])('drops the fallback copy (%s) with its content', (encoding) => {
      const attr = encoding ? ` encoding="${encoding}"` : '';
      const { doc } = run(
        parseXml,
        wrap(`<annotation-xml${attr}><p>fallback</p></annotation-xml>`),
      );

      expect(doc.querySelector('annotation-xml')).toBeNull();
      // The XHTML copy must not survive next to the MathML copy: rendering it
      // would print the formula a second time.
      expect(doc.body.textContent).toBe('a');
    });

    test.each([
      'MathML',
      'MathML-Presentation',
      'mathml-presentation',
    ])('lifts the presentation markup out (%s)', (encoding) => {
      // The shape that matters: the presentation MathML is the *only*
      // <semantics> child, so it is the rendering a reader shows.
      const { doc } = run(
        parseXml,
        math(
          `<semantics><annotation-xml encoding="${encoding}">` +
            `<mfrac><mi>a</mi><mi>b</mi></mfrac></annotation-xml></semantics>`,
        ),
      );

      expect(doc.querySelector('annotation-xml')).toBeNull();
      // Without this the sanitizer's `FORBID_CONTENTS` entry for
      // <annotation-xml> would remove the fraction and leave <math></math>.
      const mfrac = doc.querySelector('math > mfrac');
      expect(mfrac).not.toBeNull();
      expect(mfrac!.namespaceURI).toBe(MATHML_NS);
    });

    test('drops a presentation copy that sits beside the preferred child', () => {
      // `wrap` puts <mrow><mi>a</mi></mrow> first, so that is the rendering MathML
      // says to use and a renderer ignores the annotation-xml after it. Hoisting
      // must not add a second copy the reader never asked for.
      const { doc } = run(
        parseXml,
        wrap(
          `<annotation-xml encoding="MathML-Presentation"><mfrac><mi>a</mi><mi>b</mi></mfrac></annotation-xml>`,
        ),
      );

      expect(doc.querySelector('math > mrow')).not.toBeNull();
      expect(doc.querySelector('mfrac')).toBeNull();
    });

    test('drops content MathML rather than leaking its text', () => {
      const { doc } = run(
        parseXml,
        wrap(
          `<annotation-xml encoding="MathML-Content">` +
            `<apply><plus/><ci>x</ci><cn>1</cn></apply></annotation-xml>`,
        ),
      );

      expect(doc.querySelector('annotation-xml')).toBeNull();
      expect(doc.body.textContent).toBe('a');
    });
  });

  describe('elements it must not touch', () => {
    test('keeps <mprescripts/> and <none/> so script slots stay aligned', () => {
      const { changed, doc } = run(
        parseXml,
        math(
          `<mmultiscripts><mi>T</mi><mi>i</mi><mi>j</mi>` +
            `<mprescripts/><none/><mi>k</mi></mmultiscripts>`,
        ),
      );

      expect(changed).toBe(0);
      expect(
        Array.from(doc.querySelector('mmultiscripts')!.children).map((el) => el.localName),
      ).toEqual(['mi', 'mi', 'mi', 'mprescripts', 'none', 'mi']);
    });

    test('reports zero changes for canonical presentation MathML', () => {
      const { changed } = run(
        parseXml,
        math(`<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup>`),
      );

      expect(changed).toBe(0);
    });

    test('leaves markup outside MathML alone', () => {
      const { changed, doc } = run(
        parseXml,
        `<div><annotation>not math</annotation><p>text</p></div>`,
      );

      expect(changed).toBe(0);
      expect(doc.querySelector('annotation')).not.toBeNull();
    });
  });
});
