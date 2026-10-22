import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getBookProgress: vi.fn(),
  getBookData: vi.fn(),
}));

vi.mock('@/store/readerProgressStore', () => ({
  getBookProgress: h.getBookProgress,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({ getBookData: h.getBookData }),
  },
}));

import {
  buildMessageContext,
  buildReadingContext,
  buildSelectionContext,
} from '@/utils/mynexusContext';
import type { BookProgress } from '@/types/book';
import type { TextSelection } from '@/utils/sel';

const progress = (patch: Partial<BookProgress> = {}): BookProgress =>
  ({
    sectionLabel: '第三章 巳正',
    sectionHref: 'text/ch03.xhtml',
    index: 12,
    fraction: 0.42,
    page: 118,
    location: 'epubcfi(/6/26!/4/2/2[c03])',
    ...patch,
  }) as BookProgress;

const selection = (patch: Partial<TextSelection> = {}): TextSelection =>
  ({
    text: '长安一片月',
    index: 12,
    range: {},
    page: 118,
    annotated: false,
    ...patch,
  }) as TextSelection;

describe('buildReadingContext', () => {
  beforeEach(() => {
    h.getBookProgress.mockReset();
    h.getBookData.mockReset();
    h.getBookData.mockReturnValue({ book: { title: '长安十二时辰' } });
  });

  it('returns undefined without a book key', () => {
    expect(buildReadingContext(null)).toBeUndefined();
    expect(h.getBookProgress).not.toHaveBeenCalled();
  });

  it('maps progress and title to the wire shape', () => {
    h.getBookProgress.mockReturnValue(progress());
    expect(buildReadingContext('book-1')).toEqual({
      book_title: '长安十二时辰',
      chapter_title: '第三章 巳正',
      chapter_href: 'text/ch03.xhtml',
      section_index: 12,
      progress_fraction: 0.42,
      page: 118,
      cfi: 'epubcfi(/6/26!/4/2/2[c03])',
    });
  });

  it('clamps fraction and drops invalid numeric fields', () => {
    h.getBookProgress.mockReturnValue(
      progress({ fraction: 1.7, index: -1, page: 0, sectionLabel: '', sectionHref: '' }),
    );
    const context = buildReadingContext('book-1');
    expect(context?.progress_fraction).toBe(1);
    expect(context?.section_index).toBeUndefined();
    expect(context?.page).toBeUndefined();
    expect(context?.chapter_title).toBeUndefined();
    expect(context?.chapter_href).toBeUndefined();
  });

  it('clamps negative fraction and drops NaN', () => {
    h.getBookProgress.mockReturnValue(progress({ fraction: -0.2 }));
    expect(buildReadingContext('book-1')?.progress_fraction).toBe(0);
    h.getBookProgress.mockReturnValue(progress({ fraction: Number.NaN }));
    expect(buildReadingContext('book-1')?.progress_fraction).toBeUndefined();
  });

  it('truncates long titles and identifiers', () => {
    h.getBookProgress.mockReturnValue(
      progress({ sectionLabel: '题'.repeat(300), location: 'c'.repeat(600) }),
    );
    const context = buildReadingContext('book-1');
    expect(context?.chapter_title).toHaveLength(200);
    expect(context?.cfi).toHaveLength(500);
  });

  it('returns undefined when neither progress nor book exists', () => {
    h.getBookProgress.mockReturnValue(null);
    h.getBookData.mockReturnValue(undefined);
    expect(buildReadingContext('book-1')).toBeUndefined();
  });
});

describe('buildSelectionContext', () => {
  beforeEach(() => {
    h.getBookProgress.mockReset();
    h.getBookData.mockReset();
    h.getBookData.mockReturnValue({ book: { title: '长安十二时辰' } });
    h.getBookProgress.mockReturnValue(progress());
  });

  it('squeezes whitespace and truncates to 2000 characters', () => {
    const context = buildSelectionContext(
      'book-1',
      selection({ text: `  长安\n\n一片\t月  ${'字'.repeat(2100)}` }),
    );
    expect(context?.text.startsWith('长安 一片 月')).toBe(true);
    expect(context?.text).toHaveLength(2000);
  });

  it('returns undefined for blank selections', () => {
    expect(buildSelectionContext('book-1', selection({ text: ' \n\t ' }))).toBeUndefined();
  });

  it('prefers the selection href and CFI over reading progress', () => {
    const context = buildSelectionContext(
      'book-1',
      selection({ href: 'text/ch04.xhtml', cfi: 'epubcfi(/6/28)' }),
    );
    expect(context?.chapter_href).toBe('text/ch04.xhtml');
    expect(context?.cfi).toBe('epubcfi(/6/28)');
  });

  it('falls back to reading progress for PDF selections without CFI', () => {
    const context = buildSelectionContext(
      'book-1',
      selection({ index: -1, page: 0, href: undefined, cfi: undefined }),
    );
    expect(context?.section_index).toBe(12);
    expect(context?.page).toBe(118);
    expect(context?.cfi).toBe('epubcfi(/6/26!/4/2/2[c03])');
  });

  it('omits CFI when neither selection nor progress provides one', () => {
    h.getBookProgress.mockReturnValue(progress({ location: '', page: 0 }));
    const context = buildSelectionContext('book-1', selection({ cfi: undefined, page: 0 }));
    expect(context?.cfi).toBeUndefined();
    expect(context?.page).toBeUndefined();
  });
});

describe('buildMessageContext', () => {
  beforeEach(() => {
    h.getBookProgress.mockReset();
    h.getBookData.mockReset();
    h.getBookData.mockReturnValue({ book: { title: '长安十二时辰' } });
    h.getBookProgress.mockReturnValue(progress());
  });

  it('combines reading and selection', () => {
    const context = buildMessageContext('book-1', selection());
    expect(context?.reading?.chapter_title).toBe('第三章 巳正');
    expect(context?.selection?.text).toBe('长安一片月');
  });

  it('returns reading only when no selection is passed', () => {
    const context = buildMessageContext('book-1');
    expect(context?.reading).toBeDefined();
    expect(context?.selection).toBeUndefined();
  });

  it('returns undefined without any data', () => {
    h.getBookProgress.mockReturnValue(null);
    h.getBookData.mockReturnValue(undefined);
    expect(buildMessageContext('book-1')).toBeUndefined();
  });
});
