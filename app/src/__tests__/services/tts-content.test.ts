import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  consumeTtsNavigation,
  findContentByIndex,
  isChunkDocument,
  isContentVisible,
  isRangeVisibleInContent,
  markTtsNavigation,
  TTSContent,
} from '@/services/tts/ttsContent';

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

const makeDoc = (frameRect: ReturnType<typeof rect> | null): Document =>
  ({
    defaultView: {
      frameElement: frameRect
        ? {
            getBoundingClientRect: () => frameRect,
            clientWidth: frameRect.width,
            clientHeight: frameRect.height,
          }
        : null,
    },
  }) as unknown as Document;

const makeRenderer = (r: ReturnType<typeof rect>) =>
  ({ getBoundingClientRect: () => r }) as unknown as Element;

describe('ttsContent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('detects chunk documents by the foliate placeholder marker', () => {
    const chunk = new DOMParser().parseFromString(
      '<html><body><div data-foliate-chunk="1"></div><p>tail</p></body></html>',
      'text/html',
    );
    const full = new DOMParser().parseFromString(
      '<html><body><p>full</p></body></html>',
      'text/html',
    );
    expect(isChunkDocument(chunk)).toBe(true);
    expect(isChunkDocument(full)).toBe(false);
  });

  test('finds the TTS section in a non-primary column', () => {
    const contents = [
      { doc: makeDoc(null), index: 0 },
      { doc: makeDoc(null), index: 1 },
    ] as TTSContent[];
    expect(findContentByIndex(contents, 1)).toBe(contents[1]);
    expect(findContentByIndex(contents, 2)).toBeUndefined();
  });

  test('treats a content whose iframe intersects the renderer as visible', () => {
    const content = { doc: makeDoc(rect(0, 0, 100, 100)), index: 0 };
    expect(isContentVisible(makeRenderer(rect(0, 0, 100, 100)), content)).toBe(true);
    expect(isContentVisible(makeRenderer(rect(200, 200, 300, 300)), content)).toBe(false);
  });

  test('assumes only the primary content is visible when there is no iframe host', () => {
    expect(
      isContentVisible({ ...makeRenderer(rect(0, 0, 100, 100)), primaryIndex: 0 } as Element, {
        doc: makeDoc(null),
        index: 0,
      }),
    ).toBe(true);
    expect(
      isContentVisible({ ...makeRenderer(rect(0, 0, 100, 100)), primaryIndex: 0 } as Element, {
        doc: makeDoc(null),
        index: 1,
      }),
    ).toBe(false);
  });

  test('maps range rects into the reader viewport when the section iframe is wider than the page', () => {
    // The paginator expands the iframe to the section's full width (400px),
    // while the reader only shows a 200px viewport.
    const content = { doc: makeDoc(rect(0, 0, 400, 100)), index: 0 };
    const renderer = makeRenderer(rect(0, 0, 200, 100));
    const visibleRange = {
      getClientRects: () => [rect(120, 10, 140, 20)],
    } as unknown as Range;
    const offPageRange = {
      getClientRects: () => [rect(300, 10, 340, 20)],
    } as unknown as Range;
    expect(isRangeVisibleInContent(renderer, content, visibleRange)).toBe(true);
    expect(isRangeVisibleInContent(renderer, content, offPageRange)).toBe(false);
  });

  test('only consumes the relocate that matches the TTS navigation target', () => {
    markTtsNavigation('book-guard', { index: 3, cfi: 'epubcfi(/6/8!/4/2:10)' });
    // A user page turn inside the time window must keep writing progress:
    // different section, or a start position past the requested target.
    expect(consumeTtsNavigation('book-guard', { index: 5, cfi: 'epubcfi(/6/12!/4/2:0)' })).toBe(
      false,
    );
    expect(consumeTtsNavigation('book-guard', { index: 3, cfi: 'epubcfi(/6/8!/4/2:40)' })).toBe(
      false,
    );
    // The TTS relocate lands on the page that contains the target.
    expect(consumeTtsNavigation('book-guard', { index: 3, cfi: 'epubcfi(/6/8!/4/2:2)' })).toBe(
      true,
    );
    // One-shot: the guard must not swallow the next user relocate.
    expect(consumeTtsNavigation('book-guard', { index: 3, cfi: 'epubcfi(/6/8!/4/2:2)' })).toBe(
      false,
    );
  });

  test('expires a guard whose navigation never produced a relocate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    markTtsNavigation('book-expired', { index: 2 });
    vi.setSystemTime(new Date(6000));
    expect(consumeTtsNavigation('book-expired', { index: 2 })).toBe(false);
  });
});
