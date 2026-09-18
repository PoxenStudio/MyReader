import { describe, test, expect } from 'vitest';
import { mathmlTransformer } from '@/services/transformers/mathml';
import { sanitizerTransformer } from '@/services/transformers/sanitizer';
import type { TransformContext } from '@/services/transformers/types';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const page = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n` +
  `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n` +
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${inner}</body></html>`;

// What a pdf-craft/epub-generator book looks like: MathML bound to a prefix.
const PREFIXED =
  `<p>由条件 <m:math xmlns:m="${MATHML_NS}" display="inline">` +
  `<m:msup><m:mi>x</m:mi><m:mn>2</m:mn></m:msup><m:mo>+</m:mo>` +
  `<m:msup><m:mi>y</m:mi><m:mn>2</m:mn></m:msup></m:math> 都是整数可知</p>`;

// What a conforming book looks like: default namespace, already fine today.
const CANONICAL =
  `<p>由条件 <math xmlns="${MATHML_NS}"><msup><mi>x</mi><mn>2</mn></msup>` +
  `<mo>+</mo><msup><mi>y</mi><mn>2</mn></msup></math> 可知</p>`;

const ctx = (content: string, allowScript = false) =>
  ({ content, viewSettings: { allowScript } }) as unknown as TransformContext;

const normalize = (content: string) => mathmlTransformer.transform(ctx(content));

describe('mathmlTransformer', () => {
  test('rewrites prefixed MathML into the default MathML namespace', async () => {
    const out = await normalize(page(PREFIXED));

    expect(out).toContain(`<math xmlns="${MATHML_NS}"`);
    expect(out).toContain('<msup>');
    expect(out).toContain('<mi>x</mi>');
    expect(out).not.toContain('m:math');
    expect(out).not.toContain('xmlns:m=');
  });

  test('handles any prefix, not just `m`', async () => {
    const content = page(
      `<p><ns0:math xmlns:ns0="${MATHML_NS}"><ns0:msup><ns0:mi>a</ns0:mi>` +
        `<ns0:mn>2</ns0:mn></ns0:msup></ns0:math></p>`,
    );
    const out = await normalize(content);

    expect(out).toContain(`<math xmlns="${MATHML_NS}"`);
    expect(out).not.toContain('ns0:');
  });

  test('handles the declaration living on the root element', async () => {
    const content =
      `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:m="${MATHML_NS}"><head><title>t</title></head>` +
      `<body><p><m:math><m:mi>x</m:mi></m:math></p></body></html>`;
    const out = await normalize(content);

    expect(out).toContain(`<math xmlns="${MATHML_NS}"`);
    expect(out).not.toContain('m:math');
  });

  test('keeps attributes and self-closing elements', async () => {
    const content = page(
      `<p><m:math xmlns:m="${MATHML_NS}" display="block" class="fx">` +
        `<m:mfrac><m:mi>a</m:mi><m:mi>b</m:mi></m:mfrac><m:mspace/></m:math></p>`,
    );
    const out = await normalize(content);

    expect(out).toContain('display="block"');
    expect(out).toContain('class="fx"');
    expect(out).toContain('<mfrac>');
    expect(out).toContain('<mspace/>');
  });

  test('keeps the doctype and the XML declaration', async () => {
    const out = await normalize(page(PREFIXED));

    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(out).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"');
  });

  test('leaves canonical MathML byte-identical', async () => {
    const content = page(CANONICAL);

    expect(await normalize(content)).toBe(content);
  });

  test('leaves books without math byte-identical', async () => {
    const content = page('<p>一本没有公式的普通小说。</p>');

    expect(await normalize(content)).toBe(content);
  });

  test('leaves malformed XHTML alone', async () => {
    const content = page(`<p><m:math xmlns:m="${MATHML_NS}"><m:mi>x</m:mi></p>`); // unclosed <m:math>

    expect(await normalize(content)).toBe(content);
  });

  test('runs regardless of the allowScript setting', async () => {
    const content = page(PREFIXED);
    const withScripts = await mathmlTransformer.transform(ctx(content, true));

    expect(withScripts).toContain(`<math xmlns="${MATHML_NS}"`);
  });

  test('still normalizes when the section uses HTML entities', async () => {
    const content = page(
      `<p>&nbsp;由条件 <m:math xmlns:m="${MATHML_NS}"><m:msup><m:mi>x</m:mi>` +
        `<m:mn>2</m:mn></m:msup></m:math> 可知</p>`,
    );
    const out = await normalize(content);

    expect(out).toContain(`<math xmlns="${MATHML_NS}"`);
    expect(out).not.toContain('m:math');
  });

  describe('survives the rest of the pipeline', () => {
    // The bug this transformer fixes: the sanitizer parses with an HTML parser,
    // which sees `m:math` as an unknown element, drops the wrappers and keeps
    // the text — the formula then renders as `x2+y2`.
    test('sanitizer drops prefixed MathML when normalization is skipped', async () => {
      const out = await sanitizerTransformer.transform(ctx(page(PREFIXED)));
      const doc = new DOMParser().parseFromString(out, 'text/html');

      expect(doc.querySelector('math')).toBeNull();
      expect(doc.body.textContent).toContain('x2+y2');
    });

    test('sanitized output keeps MathML in the MathML namespace', async () => {
      const normalized = await normalize(page(PREFIXED));
      const out = await sanitizerTransformer.transform(ctx(normalized));

      // `srcdoc` is always parsed as HTML; the namespace is what decides
      // whether the engine lays the formula out as math or as plain text.
      const doc = new DOMParser().parseFromString(out, 'text/html');
      const math = doc.querySelector('math');

      expect(math).not.toBeNull();
      expect(math!.namespaceURI).toBe(MATHML_NS);
      expect(doc.body.textContent).toContain('都是整数可知');
    });
  });
});
