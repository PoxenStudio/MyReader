import { describe, expect, test } from 'vitest';
import {
  findContentByIndex,
  isContentVisible,
  isRangeVisibleInContent,
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
});
