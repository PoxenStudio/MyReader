import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BookProgress } from '@/types/book';

const progressState: { current: BookProgress | null } = { current: null };

const renderer = { page: 0, pages: 5 };
const mockView = {
  renderer: {
    get page() {
      return renderer.page;
    },
    get pages() {
      return renderer.pages;
    },
    goTo: vi.fn(),
  },
  resolveNavigation: vi.fn((target: string) => ({ index: 0, target })),
};

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => progressState.current,
}));

vi.mock('@/store/readerStore', () => {
  const store = { getView: () => mockView };
  return {
    useReaderStore: <R,>(selector: (s: typeof store) => R) => selector(store),
  };
});

import { useBackToPreviousLocation } from '@/app/reader/hooks/useBackToPreviousLocation';

const progress = (overrides: Partial<BookProgress>): BookProgress => ({
  location: 'cfi-ch1',
  sectionHref: 'ch1.xhtml',
  sectionLabel: 'Chapter 1',
  section: { current: 0, total: 10 },
  pageinfo: { current: 0, total: 100 },
  pageItem: null,
  timeinfo: { section: 0, total: 0 },
  fraction: 0,
  index: 0,
  range: {} as Range,
  page: 1,
  ...overrides,
});

describe('useBackToPreviousLocation', () => {
  afterEach(() => {
    cleanup();
    progressState.current = null;
    renderer.page = 0;
    vi.clearAllMocks();
  });

  test('returns to the recorded location and clears the prompt', () => {
    progressState.current = progress({ location: 'cfi-ch1-p3', index: 1, page: 3 });
    const { result, rerender } = renderHook(() => useBackToPreviousLocation('b1'));
    expect(result.current.location).toBeNull();

    progressState.current = progress({
      location: 'cfi-ch5-p1',
      sectionHref: 'ch5.xhtml',
      index: 5,
      page: 20,
    });
    rerender();
    expect(result.current.location).toBe('cfi-ch1-p3');

    act(() => result.current.handleBack());
    expect(mockView.resolveNavigation).toHaveBeenCalledWith('cfi-ch1-p3');
    expect(mockView.renderer.goTo).toHaveBeenCalledTimes(1);
    expect(result.current.location).toBeNull();
  });
});
