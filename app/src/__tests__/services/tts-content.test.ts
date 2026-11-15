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
      frameElement: frameRect ? { getBoundingClientRect: () => frameRect } : null,
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

  test('checks the spoken range against the iframe viewport, not just the frame', () => {
    const content = { doc: makeDoc(rect(0, 0, 100, 100)), index: 0 };
    const visibleRange = {
      getClientRects: () => [rect(10, 10, 40, 20)],
    } as unknown as Range;
    const offPageRange = {
      getClientRects: () => [rect(200, 10, 240, 20)],
    } as unknown as Range;
    expect(isRangeVisibleInContent(content, visibleRange)).toBe(true);
    expect(isRangeVisibleInContent(content, offPageRange)).toBe(false);
  });
});
