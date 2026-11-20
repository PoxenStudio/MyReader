import { describe, expect, test } from 'vitest';
import {
  buildRawAnchor,
  collectTextStream,
  collectWindowAtPoint,
  extractTextAround,
  fnv1a,
  isCfiWithinRange,
  mapRawAnchorToRendered,
  mapRenderedOffsetToRaw,
  normalizeSearchable,
  normalizeString,
  RAW_TEXT_VERSION,
  textOffsetToRange,
  type RawTextInfo,
  type SearchableText,
} from '@/services/mybooks/rawLocation';

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
  test('extractTextAround keeps the offset aligned with the quote', () => {
    const text = '前文目标句子后文';
    const { quote, prefix, suffix } = extractTextAround(text, 2, 4, 2);
    expect(quote).toBe('目标句子');
    expect(prefix).toBe('前文');
    expect(suffix).toBe('后文');
  });

  test('isCfiWithinRange checks containment, not exact landing', () => {
    const page = 'epubcfi(/6/4!/4/2,/1:0,/1:20)';
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:10)', page)).toBe(true);
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:0)', page)).toBe(true);
    expect(isCfiWithinRange('epubcfi(/6/4!/4/2/1:21)', page)).toBe(false);
    expect(isCfiWithinRange('not-a-cfi', page)).toBe(false);
  });
});
