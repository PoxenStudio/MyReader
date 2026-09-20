import { describe, test, expect } from 'vitest';
import { latexTransformer } from '@/services/transformers/latex';
import { sanitizerTransformer } from '@/services/transformers/sanitizer';
import type { TransformContext } from '@/services/transformers/types';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const page = (inner: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n` +
  `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n` +
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${inner}</body></html>`;

const ctx = (content: string, allowScript = false) =>
  ({ content, viewSettings: { allowScript } }) as unknown as TransformContext;

const transform = (content: string) => latexTransformer.transform(ctx(content));
const asHtml = (content: string) => new DOMParser().parseFromString(content, 'text/html');

describe('latexTransformer', () => {
  test('renders an inline \\(…\\) run into MathML', async () => {
    const out = await transform(page('<p>得 \\(x^2\\) 成立</p>'));

    expect(out).toContain('<msup>');
    expect(out).toContain('<mi>x</mi>');
    expect(out).not.toContain('\\(');
    expect(out).toContain('成立');
  });

  test('renders $$…$$ as display math', async () => {
    const out = await transform(page('<p>$$\\frac{a}{b}$$</p>'));

    expect(out).toContain('<mfrac>');
    expect(out).toContain('display="block"');
  });

  test('renders \\[…\\] as display math', async () => {
    const out = await transform(page('<p>\\[E=mc^2\\]</p>'));

    expect(out).toContain('<msup>');
    expect(out).toContain('display="block"');
  });

  test('renders a bare $…$ run that reads as TeX', async () => {
    const out = await transform(page('<p>于是 $E=mc^2$ 成立</p>'));

    expect(out).toContain('<math');
    expect(out).toContain('<msup>');
    expect(out).not.toContain('$E=mc^2$');
    expect(asHtml(out).body.textContent).toContain('于是');
  });

  test('renders several formulas in one section', async () => {
    const out = await transform(page('<p>先 \\(a\\) 后 $$b$$ 末</p>'));

    expect(out.match(/<math/g)).toHaveLength(2);
  });

  // Books exported straight from LaTeX often carry display math as an
  // environment with no `$` at all, which the old `MAYBE_TEX_RE` gate let
  // through untouched.
  describe('LaTeX environments without a $ delimiter', () => {
    test('renders \\begin{equation}…\\end{equation}', async () => {
      const out = await transform(
        page('<p>由 \\begin{equation}x^2 + y^2 = z^2\\end{equation} 可知</p>'),
      );

      expect(out).toContain('<msup>');
      expect(out).toContain('display="block"');
      expect(out).not.toContain('\\begin{equation}');
      expect(out).toContain('可知');
    });

    test('renders a multi-line \\begin{align}', async () => {
      // `&` has to be `&amp;` in the section source, as in any XHTML book.
      const out = await transform(
        page('<p>\\begin{align}a &amp;= b \\\\ c &amp;= d\\end{align}</p>'),
      );

      expect(out).not.toContain('\\begin{align}');
      expect(asHtml(out).querySelectorAll('math')).toHaveLength(1);
    });

    test('renders several environments in one section', async () => {
      const out = await transform(
        page('<p>\\begin{equation}a\\end{equation} 与 \\begin{gather}b\\end{gather}</p>'),
      );

      expect(out.match(/<math/g)).toHaveLength(2);
    });

    test('keeps a nested environment inside its parent', async () => {
      const out = await transform(
        page(
          '<p>\\begin{equation}\\begin{aligned}a &amp;= b \\\\ c &amp;= d\\end{aligned}' +
            '\\end{equation}</p>',
        ),
      );

      expect(out.match(/<math/g)).toHaveLength(1);
      expect(out).not.toContain('\\end{aligned}');
    });

    test('leaves an environment KaTeX cannot render as source', async () => {
      const content = page('<p>\\begin{multline}a + b\\end{multline}</p>');

      expect(await transform(content)).toBe(content);
    });

    test('leaves a non-math environment alone', async () => {
      const content = page('<p>\\begin{itemize}\\item a\\end{itemize}</p>');

      expect(await transform(content)).toBe(content);
    });

    test('leaves an unclosed environment alone', async () => {
      const content = page('<p>\\begin{equation}一直没结束</p>');

      expect(await transform(content)).toBe(content);
    });
  });

  describe('leaves ordinary dollar signs alone', () => {
    test('prices', async () => {
      const content = page('<p>这本书花了 $5 和 $10 元</p>');

      expect(await transform(content)).toBe(content);
    });

    test('shell variables', async () => {
      const content = page('<p>用 $HOME$PATH 取路径</p>');

      expect(await transform(content)).toBe(content);
    });

    test('a run whose content is not TeX-ish', async () => {
      const content = page('<p>输入 $HOME 回车</p>');

      expect(await transform(content)).toBe(content);
    });

    test('a rejected $ can still pair with a later one', async () => {
      const out = await transform(page('<p>价格 $5, 于是 $x^2$ 成立</p>'));

      expect(out).toContain('价格 $5, 于是');
      expect(out).toContain('<msup>');
    });
  });

  describe('skips content it must not touch', () => {
    test('verbatim blocks', async () => {
      const content = page('<pre><code>echo \\(x\\)</code></pre>');

      expect(await transform(content)).toBe(content);
    });

    test('math the engine already renders natively', async () => {
      const content = page(`<math xmlns="${MATHML_NS}"><mtext>\\(x\\)</mtext></math>`);

      expect(await transform(content)).toBe(content);
    });
  });

  test('keeps the source text of a formula the engine cannot parse', async () => {
    const content = page('<p>得 \\(\\frac{\\) 成立</p>');

    expect(await transform(content)).toBe(content);
  });

  test('still renders when the section uses HTML entities', async () => {
    const out = await transform(page('<p>&nbsp;于是 $E=mc^2$&nbsp;成立</p>'));

    expect(out).toContain('<math');
    expect(out).toContain('<msup>');
  });

  test('keeps the doctype and the XML declaration', async () => {
    const out = await transform(page('<p>\\(x\\)</p>'));

    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(out).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"');
  });

  test('leaves books without TeX byte-identical', async () => {
    const content = page('<p>一本没有公式的普通小说。</p>');

    expect(await transform(content)).toBe(content);
  });

  test('leaves malformed XHTML alone', async () => {
    const content = page('<p>\\(x\\)</p'); // unclosed

    expect(await transform(content)).toBe(content);
  });

  describe('through the sanitizer', () => {
    test('the formula survives in the MathML namespace', async () => {
      const transformed = await transform(page('<p>于是 $E=mc^2$ 成立</p>'));
      const sanitized = await sanitizerTransformer.transform(ctx(transformed));
      const math = asHtml(sanitized).querySelector('math');

      expect(math).not.toBeNull();
      expect(math!.namespaceURI).toBe(MATHML_NS);
    });

    test('the TeX source does not leak as visible text', async () => {
      const transformed = await transform(page('<p>于是 $E=mc^2$ 成立</p>'));

      // <semantics>/<annotation> are disallowed MathML for the sanitizer: it
      // unwraps them and keeps their text, printing the TeX source beside the
      // formula it came from.
      expect(transformed).not.toContain('<annotation');
      expect(transformed).not.toContain('<semantics');

      const sanitized = await sanitizerTransformer.transform(ctx(transformed));

      // The trailing newline is the sanitizer's own formatting before </body>.
      expect(asHtml(sanitized).body.textContent?.trim()).toBe('于是 E=mc2 成立');
    });
  });
});
