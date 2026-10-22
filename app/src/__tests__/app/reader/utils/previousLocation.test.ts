import { describe, expect, it } from 'vitest';
import type { BookProgress } from '@/types/book';
import {
  MAX_PAGES_AFTER_CHAPTER_SWITCH,
  type SectionPage,
  createPreviousLocationTracker,
  updatePreviousLocationTracker,
} from '@/app/reader/utils/previousLocation';

const progress = (overrides: Partial<BookProgress> = {}): BookProgress => {
  const index = overrides.index ?? 0;
  return {
    location: `cfi-${index}`,
    sectionHref: `ch${index}.xhtml`,
    sectionLabel: `Chapter ${index}`,
    section: { current: index, total: 10 },
    pageinfo: { current: 0, total: 10 },
    pageItem: null,
    timeinfo: { section: 0, total: 0 },
    fraction: 0,
    index,
    range: {} as Range,
    page: 1,
    ...overrides,
  };
};

type Step = BookProgress | [BookProgress, SectionPage];

const track = (items: Step[]) => {
  let tracker = createPreviousLocationTracker();
  for (const item of items) {
    tracker = Array.isArray(item)
      ? updatePreviousLocationTracker(tracker, item[0], item[1])
      : updatePreviousLocationTracker(tracker, item);
  }
  return tracker;
};

describe('previous location tracker', () => {
  it('does not offer a return position before the first chapter switch', () => {
    const tracker = track([progress({ index: 1, page: 3 })]);
    expect(tracker.location).toBeNull();
  });

  it('records the position before a chapter switch', () => {
    const tracker = track([
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
      progress({ index: 5, page: 1, location: 'cfi-ch5-p1' }),
    ]);
    expect(tracker.location).toBe('cfi-ch1-p3');
  });

  it('keeps the prompt for two page turns and hides it after the third', () => {
    let tracker = track([
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
      progress({ index: 5, page: 1, pageinfo: { current: 0, total: 10 } }),
    ]);
    expect(tracker.location).toBe('cfi-ch1-p3');

    for (let page = 2; page <= MAX_PAGES_AFTER_CHAPTER_SWITCH + 1; page++) {
      tracker = updatePreviousLocationTracker(
        tracker,
        progress({ index: 5, page, pageinfo: { current: page - 1, total: 10 } }),
      );
      expect(tracker.location).not.toBeNull();
    }

    tracker = updatePreviousLocationTracker(
      tracker,
      progress({
        index: 5,
        page: MAX_PAGES_AFTER_CHAPTER_SWITCH + 2,
        pageinfo: { current: MAX_PAGES_AFTER_CHAPTER_SWITCH + 1, total: 10 },
      }),
    );
    expect(tracker.location).toBeNull();
  });

  it('keeps the original position when chapters are switched consecutively', () => {
    const tracker = track([
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
      progress({ index: 5, page: 1, pageinfo: { current: 0, total: 10 } }),
      progress({ index: 9, page: 1, pageinfo: { current: 0, total: 10 } }),
    ]);
    expect(tracker.location).toBe('cfi-ch1-p3');
  });

  it('does not prompt when page turning crosses a chapter boundary', () => {
    const tracker = track([
      [
        progress({
          index: 1,
          page: 10,
          pageinfo: { current: 9, total: 10 },
          location: 'cfi-ch1-p10',
        }),
        { page: 9, pages: 10 },
      ],
      [
        progress({ index: 2, page: 1, pageinfo: { current: 10, total: 20 } }),
        { page: 0, pages: 8 },
      ],
    ]);
    expect(tracker.location).toBeNull();
  });

  it('hides the prompt after manually returning to the recorded chapter', () => {
    const tracker = track([
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
      progress({ index: 5, page: 1, pageinfo: { current: 0, total: 10 } }),
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
    ]);
    expect(tracker.location).toBeNull();
  });

  it('hides the prompt after a multi-page jump within the new chapter', () => {
    const tracker = track([
      progress({ index: 1, page: 3, location: 'cfi-ch1-p3' }),
      progress({ index: 5, page: 1, pageinfo: { current: 0, total: 10 } }),
      progress({ index: 5, page: 8, pageinfo: { current: 7, total: 10 } }),
    ]);
    expect(tracker.location).toBeNull();
  });
});
