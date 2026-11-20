import { describe, expect, test } from 'vitest';
import {
  buildRawAnchor,
  buildRawAnchorForRange,
  collectTextStream,
  collectWindowAtPoint,
  extractQuote,
  fnv1a,
  isCfiWithinRange,
  mapRawAnchorToRendered,
  mapRenderedOffsetToRaw,
  normalizeSearchable,
  normalizeString,
  RAW_TEXT_VERSION,
  resetLocationCaches,
  resolveRawAnchorToCfi,
  sectionFractionOf,
  textOffsetToRange,
  type RawTextInfo,
  type SearchableText,
} from '@/services/mybooks/rawLocation';
import type { FoliateView } from '@/types/view';

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

const rawFromHtml = (html: string): RawTextInfo => {
  const stream = collectTextStream(parse(html), { skipInert: false, skipChunk: false });
  return {
    searchable: normalizeSearchable(stream),
    hash: `${fnv1a(stream.text)}-${stream.text.length}`,
    version: RAW_TEXT_VERSION,
  };
};

const renderedFromHtml = (
  html: string,
  convertVariant?: (text: string) => string,
): SearchableText => normalizeSearchable(collectTextStream(parse(html)), { convertVariant });

describe('rawLocation text stream', () => {
  test('skips script/style and cfi-inert nodes', () => {
    const doc = parse(`<html><body>
      <p>可见文字</p>
      <script>隐藏脚本</script>
      <style>.x{}</style>
      <span cfi-inert="true">注入文字</span>
      <p>结尾</p>
    </body></html>`);
    const stream = collectTextStream(doc, { skipInert: true, skipChunk: true });
    expect(stream.text).not.toContain('隐藏脚本');
    expect(stream.text).not.toContain('注入文字');
    expect(stream.text).toContain('可见文字');
    expect(stream.text).toContain('结尾');
    expect(stream.nodes.length).toBe(stream.text.length);
  });

  test('maps a text offset back to a Range', () => {
    const doc = parse('<html><body><p>abcdef</p></body></html>');
    const stream = collectTextStream(doc);
    const searchable = normalizeSearchable(stream);
    const offset = stream.text.indexOf('cd');
    const range = textOffsetToRange(searchable, offset);
    expect(range).not.toBeNull();
    expect(range!.startContainer.textContent).toBe('abcdef');
    expect(range!.startOffset).toBe(2);
  });

  test('maps a text offset to a Range from the sparse node table', () => {
    const doc = parse('<html><body><p>abc</p><p>def</p></body></html>');
    // Mirrors the huge-section path: no per-character tables, only nodeStarts.
    const stream = collectTextStream(doc, {
      skipInert: true,
      skipChunk: true,
      collectPositions: false,
    });
    const searchable = normalizeSearchable(stream);
    expect(searchable.nodes).toHaveLength(0);
    const range = textOffsetToRange(searchable, 4);
    expect(range).not.toBeNull();
    expect(range!.startContainer.textContent).toBe('def');
    expect(range!.startOffset).toBe(1);
  });
});

describe('rawLocation normalization and mapping', () => {
  test('keeps normalized indices aligned across astral characters', () => {
    const text = 'ABC𠮷DEF😀目标句子';
    const stream = collectTextStream(parse(`<html><body><p>${text}</p></body></html>`));
    const searchable = normalizeSearchable(stream);
    const target = text.indexOf('目标');
    const normalizedIndex = searchable.textToNormalized[target]!;
    // Also assert the normalized string actually points at the CJK char:
    // a code-point-indexed implementation keeps the two tables mutually
    // inverse yet points at a lone surrogate here.
    expect(searchable.normalized[normalizedIndex]).toBe('目');
    expect(searchable.normalized.startsWith('目标', normalizedIndex)).toBe(true);
    expect(searchable.normalizedToText[normalizedIndex]).toBe(target);
  });

  test('rejects non-finite offsets without falling to the last text node', () => {
    const doc = parse('<html><body><p>abcdef</p></body></html>');
    const searchable = normalizeSearchable(collectTextStream(doc));
    expect(textOffsetToRange(searchable, Number.NaN)).toBeNull();
    const raw = rawFromHtml('<html><body><p>abcdef</p></body></html>');
    const anchor = { ...buildRawAnchor(raw, 0, 2, 'exact'), rawOffset: Number.NaN };
    const mapped = mapRawAnchorToRendered(raw, searchable, anchor);
    expect(mapped.mode).toBe('approx');
    expect(Number.isFinite(mapped.offset)).toBe(true);
  });

  test('collapses whitespace and punctuation before matching', () => {
    expect(normalizeString('目标\u00A0\u00A0句子 “引号”')).toBe('目标 句子 "引号"');
    expect(normalizeString('目标   句子')).toBe(normalizeString('目标\u3000句子'));
  });

  test('maps a raw anchor to the rendered text with collapsed whitespace', () => {
    const raw = rawFromHtml(
      '<html><body><p>第一段：前面&#160;&#160;有很多内容。</p><p>目标句子在这里：春眠不觉晓，处处闻啼鸟。</p></body></html>',
    );
    const rendered = renderedFromHtml(
      '<html><body><p>第一段：前面 有很多内容。</p><p>目标句子在这里：春眠不觉晓，处处闻啼鸟。</p></body></html>',
    );
    const rawOffset = raw.searchable.text.indexOf('目标句子');
    const anchor = buildRawAnchor(raw, 3, rawOffset, 'exact');
    const mapped = mapRawAnchorToRendered(raw, rendered, anchor);
    expect(mapped.mode).toBe('exact');
    expect(rendered.text.slice(mapped.offset, mapped.offset + 4)).toBe('目标句子');
  });

  test('maps across simplified/traditional variant differences', () => {
    const raw = rawFromHtml('<html><body><p>目标里</p></body></html>');
    const rendered = renderedFromHtml('<html><body><p>目标裏</p></body></html>', (text) =>
      text.replace(/裏/g, '里'),
    );
    const anchor = buildRawAnchor(raw, 0, raw.searchable.text.indexOf('目标'), 'exact');
    const mapped = mapRawAnchorToRendered(raw, rendered, anchor);
    expect(mapped.mode).toBe('exact');
    expect(rendered.text.slice(mapped.offset, mapped.offset + 2)).toBe('目标');
  });

  test('maps around inserted wrapper markup', () => {
    const raw = rawFromHtml(
      '<html><body><p>前面文字。目标句子在这里。</p><p>后面文字。</p></body></html>',
    );
    const rendered = renderedFromHtml(
      '<html><body><p>前面文字。<span class="warichu-pending">目标句子在这里。</span></p><p>后面文字。</p></body></html>',
    );
    const anchor = buildRawAnchor(raw, 0, raw.searchable.text.indexOf('目标句子'), 'exact');
    const mapped = mapRawAnchorToRendered(raw, rendered, anchor);
    expect(mapped.mode).toBe('exact');
    expect(rendered.text.slice(mapped.offset, mapped.offset + 4)).toBe('目标句子');
  });

  test('falls back to a fraction position for an approx anchor', () => {
    const raw = rawFromHtml('<html><body><p>一二三四五六七八九十</p></body></html>');
    const rendered = renderedFromHtml('<html><body><p>壹贰叁肆伍陆柒捌玖拾</p></body></html>');
    const anchor = buildRawAnchor(raw, 0, 5, 'approx');
    const mapped = mapRawAnchorToRendered(raw, rendered, anchor);
    expect(mapped.mode).toBe('approx');
    expect(mapped.offset).toBeGreaterThanOrEqual(0);
    expect(mapped.offset).toBeLessThan(rendered.text.length);
  });

  test('maps a rendered position back to the raw text', () => {
    const raw = rawFromHtml(
      '<html><body><p>第一段：前面&#160;&#160;有很多内容。</p><p>目标句子在这里。</p></body></html>',
    );
    const renderedDoc = parse(
      '<html><body><p>第一段：前面 有很多内容。</p><p>目标句子在这里。</p></body></html>',
    );
    const rendered = normalizeSearchable(collectTextStream(renderedDoc));
    const textNode = rendered.nodes[rendered.text.indexOf('目标句子')]!;
    const window = collectWindowAtPoint(renderedDoc, textNode, 0, 96);
    expect(window?.text.startsWith('目标句子')).toBe(true);
    const mapped = mapRenderedOffsetToRaw(
      rendered,
      raw.searchable,
      rendered.text.indexOf('目标句子'),
    );
    expect(raw.searchable.text.slice(mapped.offset, mapped.offset + 4)).toBe('目标句子');
  });
});

describe('rawLocation anchor helpers', () => {
  test('extractQuote keeps the offset aligned with the quote', () => {
    const text = '前文目标句子后文';
    expect(extractQuote(text, 2, 4)).toBe('目标句子');
    expect(extractQuote(text, 0, 2)).toBe('前文');
    expect(extractQuote(text, text.length + 5, 4)).toBe('');
  });

  test('buildRawAnchor stores the position clock and nothing else private', () => {
    const raw = rawFromHtml('<html><body><p>目标句子</p></body></html>');
    const anchor = buildRawAnchor(raw, 2, 0, 'exact', 1234);
    expect(anchor).toMatchObject({
      v: 2,
      index: 2,
      rawOffset: 0,
      rawQuote: '目标句子',
      precision: 'exact',
      updatedAt: 1234,
    });
    expect(anchor).not.toHaveProperty('rawPrefix');
    expect(anchor).not.toHaveProperty('rawSuffix');
    expect(buildRawAnchor(raw, 0, 0, 'approx').updatedAt).toBeUndefined();
  });

  test('isCfiWithinRange checks containment, not exact landing', () => {
    const page = 'epubcfi(/6/4!/4/2,/1:0,/1:20)';
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:10)', page)).toBe(true);
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:0)', page)).toBe(true);
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:21)', page)).toBe(false);
    expect(isCfiWithinRange('not-a-cfi', page)).toBe(false);
  });

  test('sectionFractionOf maps a book fraction into the section', () => {
    const view = { getSectionFractions: () => [0, 0.25, 0.75, 1] };
    expect(sectionFractionOf(view, 1, 0.5)).toBeCloseTo(0.5);
    expect(sectionFractionOf(view, 0, 0.1)).toBeCloseTo(0.4);
    expect(sectionFractionOf(view, 2, 0.2)).toBe(0);
    expect(sectionFractionOf({}, 3, 0.5)).toBe(0.5);
  });
});

describe('rawLocation cross-setting fallback', () => {
  // The reverse converter assumes the book sits on the opposite side of the
  // reader's variant setting. When the book already IS in the target variant
  // the conversion moves away from the raw text; matching must retry the
  // unconverted stream instead of degrading to a fraction guess.
  test('mapRawAnchorToRendered falls back to the unconverted stream', () => {
    const raw = rawFromHtml('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>');
    const converted = normalizeSearchable(
      collectTextStream(parse('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>')),
      { convertVariant: (t) => t.replace(/裏/g, '里') },
    );
    const plain = normalizeSearchable(
      collectTextStream(parse('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>')),
    );
    const anchor = buildRawAnchor(raw, 0, raw.searchable.text.indexOf('裏面'), 'exact');
    expect(mapRawAnchorToRendered(raw, converted, anchor).mode).toBe('approx');
    const mapped = mapRawAnchorToRendered(raw, converted, anchor, plain);
    expect(mapped.mode).toBe('exact');
    expect(plain.text.slice(mapped.offset, mapped.offset + 2)).toBe('裏面');
  });

  test('mapRenderedOffsetToRaw falls back to the unconverted stream', () => {
    const raw = rawFromHtml('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>');
    const converted = normalizeSearchable(
      collectTextStream(parse('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>')),
      { convertVariant: (t) => t.replace(/裏/g, '里') },
    );
    const plain = normalizeSearchable(
      collectTextStream(parse('<html><body><p>這是一本繁體書，裏面有很多內容。</p></body></html>')),
    );
    const offset = plain.text.indexOf('裏面');
    const mapped = mapRenderedOffsetToRaw(converted, raw.searchable, offset, 0.5, plain);
    expect(mapped.mode).toBe('exact');
    expect(raw.searchable.text.slice(mapped.offset, mapped.offset + 2)).toBe('裏面');
  });
});

describe('rawLocation build/resolve integration', () => {
  const rawHtml =
    '<html><body><p>第一段：前面有很多内容。</p><p>目标句子在这里，后面还有一点。</p></body></html>';
  // Same book as device A would transform it (NBSP folded, quotes replaced),
  // and a second device whose layout keeps different whitespace.
  const deviceA =
    '<html><body><p>第一段：前面 有很多内容。</p><p>目标句子在这里，后面还有一点。</p></body></html>';
  const deviceB =
    '<html><body><p>第一段：前面有很多内容。</p><p>目标句子在这里，后面还有一点。</p><p>新增的注释。</p></body></html>';

  const makeView = (renderedHtml: string): FoliateView => {
    const section = {
      createDocument: async () => parse(rawHtml),
      load: async () => {},
      loadContent: async () => renderedHtml,
      unload: () => {},
    };
    return {
      book: { sections: [section] },
      getSectionFractions: () => [0, 1],
      getCFI: (_index: number, range: Range) => {
        const text = (range.startContainer as Text).nodeValue ?? '';
        return `epubcfi(fake:${text.slice(0, 4)}:${range.startOffset})`;
      },
    } as unknown as FoliateView;
  };

  const rangeAt = (html: string, needle: string): Range => {
    const doc = parse(html);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const index = node.nodeValue?.indexOf(needle) ?? -1;
      if (index >= 0) {
        const range = doc.createRange();
        range.setStart(node, index);
        range.collapse(true);
        return range;
      }
      node = walker.nextNode() as Text | null;
    }
    throw new Error(`needle not found: ${needle}`);
  };

  test('an anchor built under one setting resolves under another', async () => {
    const viewA = makeView(deviceA);
    const viewB = makeView(deviceB);
    const anchor = await buildRawAnchorForRange(
      'integration-a',
      viewA,
      0,
      rangeAt(deviceA, '目标句子'),
      0.5,
      null,
      777,
    );
    expect(anchor).not.toBeNull();
    expect(anchor!.updatedAt).toBe(777);
    expect(anchor!.precision).toBe('exact');

    const resolved = await resolveRawAnchorToCfi('integration-b', viewB, anchor!, null);
    expect(resolved).not.toBeNull();
    expect(resolved!.mode).toBe('exact');
    // The fake CFI encodes the first characters of the text node the range
    // landed in; it must be the paragraph holding the anchored sentence.
    expect(resolved!.cfi).toContain('目标句子');
  });

  test('a section hash change degrades to a fraction instead of failing', async () => {
    const viewA = makeView(deviceA);
    const viewB = makeView(deviceB);
    const anchor = await buildRawAnchorForRange(
      'integration-c',
      viewA,
      0,
      rangeAt(deviceA, '目标句子'),
      0.5,
      null,
    );
    expect(anchor).not.toBeNull();
    const resolved = await resolveRawAnchorToCfi(
      'integration-d',
      viewB,
      { ...anchor!, sectionHash: 'stale-hash' },
      null,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.mode).toBe('approx');
  });

  test('clears its caches per book key', async () => {
    const view = makeView(deviceA);
    await buildRawAnchorForRange('integration-e', view, 0, rangeAt(deviceA, '目标句子'), 0.5, null);
    resetLocationCaches('integration-e');
    // No assertion on internals: just ensure the reset path does not throw and
    // the next build works from a cold cache.
    const again = await buildRawAnchorForRange(
      'integration-e',
      view,
      0,
      rangeAt(deviceA, '目标句子'),
      0.5,
      null,
    );
    expect(again).not.toBeNull();
  });
});
