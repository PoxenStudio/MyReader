import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { isMobile: false, hasContextMenu: false, isAndroidApp: false },
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0 } }),
}));

// Sort by title, ascending — if the sort weren't skipped for search results,
// this would reorder the books into alphabetical order (book-aaa, book-zzz).
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      libraryViewMode: 'grid',
      librarySortBy: 'title',
      librarySortAscending: true,
      libraryGroupBy: 'none',
      librarySortByAuto: false,
      librarySortBy2: 'none',
      libraryCoverFit: 'crop',
      libraryAutoColumns: true,
      libraryColumns: 4,
      openBookInNewWindow: false,
    },
  }),
}));

const libraryStoreState = {
  setCurrentBookshelf: vi.fn(),
  setLibrary: vi.fn(),
  updateBooks: vi.fn(),
  setSelectedBooks: vi.fn(),
  getSelectedBooks: () => [] as string[],
  toggleSelectedBook: vi.fn(),
  getGroupName: () => '',
};
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => libraryStoreState,
}));

vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
}));

vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: () => [vi.fn(), () => undefined],
}));

vi.mock('react-virtuoso', () => {
  // Renders every item eagerly (no real virtualization) so tests can assert
  // on rendering order without a viewport-sized jsdom layout.
  const StubList = (props: {
    totalCount: number;
    itemContent: (index: number, context?: unknown) => React.ReactNode;
    computeItemKey?: (index: number) => string | number;
    context?: unknown;
  }) => {
    const items = [];
    for (let i = 0; i < props.totalCount; i++) {
      items.push(
        <div key={props.computeItemKey ? props.computeItemKey(i) : i}>
          {props.itemContent(i, props.context)}
        </div>,
      );
    }
    return <div>{items}</div>;
  };
  return {
    Virtuoso: StubList,
    VirtuosoGrid: StubList,
  };
});

vi.mock('@/app/library/components/BookshelfItem', () => ({
  // `groupBy: 'none'` in this test never exercises the real grouping helper,
  // so a stub is enough to avoid pulling in BookshelfItem's heavy (Tauri
  // menu, router) dependencies.
  generateBookshelfItems: vi.fn(),
  default: ({ item }: { item: { hash?: string; id?: string } }) => (
    <div data-testid='book-item'>{'hash' in item ? item.hash : item.id}</div>
  ),
}));

vi.mock('@/app/library/components/SelectModeActions', () => ({ default: () => null }));
vi.mock('@/app/library/components/SendToDeviceDialog', () => ({ default: () => null }));
vi.mock('@/app/library/components/GroupingModal', () => ({ default: () => null }));
vi.mock('@/app/library/components/SetStatusAlert', () => ({ default: () => null }));
vi.mock('@/components/Alert', () => ({ default: () => null }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

import Bookshelf from '@/app/library/components/Bookshelf';

afterEach(() => {
  cleanup();
  searchParamsValue = new URLSearchParams();
});

const makeBook = (hash: string, title: string): Book => ({
  hash,
  format: 'EPUB',
  title,
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  bookId: 0,
  storageType: 'cloud',
});

const baseProps = {
  isSelectMode: false,
  isSelectAll: false,
  isSelectNone: false,
  onScrollerRef: vi.fn(),
  handleImportBooks: vi.fn(),
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  handleBookDelete: vi.fn(),
  handleBookPurge: vi.fn(),
  handleSetSelectMode: vi.fn(),
  handleShowDetailsBook: vi.fn(),
  handleLibraryNavigation: vi.fn(),
  booksTransferProgress: {},
};

// Server order deliberately not alphabetical, so a client-side title sort
// would visibly reorder them.
const serverOrderedBooks = [makeBook('book-zzz', 'Zzz Title'), makeBook('book-aaa', 'Aaa Title')];

describe('Bookshelf cloud listings ignore the sort setting', () => {
  it('keeps MyBooks server order for cloud search results, ignoring the sort-by setting', () => {
    searchParamsValue = new URLSearchParams('source=cloud&type=search');

    render(
      <Bookshelf
        {...baseProps}
        libraryBooks={serverOrderedBooks}
        source='cloud'
        isCloudLibrary
        cloudBooksTotal={2}
      />,
    );

    const rendered = screen.getAllByTestId('book-item').map((el) => el.textContent);
    expect(rendered).toEqual(['book-zzz', 'book-aaa']);
  });

  it(
    'also keeps server order for a regular cloud browse listing (not search) — a Load More ' +
      'page must append, not jump to the front',
    () => {
      searchParamsValue = new URLSearchParams('source=cloud&type=all');

      render(
        <Bookshelf
          {...baseProps}
          libraryBooks={serverOrderedBooks}
          source='cloud'
          isCloudLibrary
          cloudBooksTotal={2}
        />,
      );

      const rendered = screen.getAllByTestId('book-item').map((el) => el.textContent);
      expect(rendered).toEqual(['book-zzz', 'book-aaa']);
    },
  );

  it('still sorts the local library by title (unaffected — only cloud listings skip sorting)', () => {
    searchParamsValue = new URLSearchParams();

    render(
      <Bookshelf
        {...baseProps}
        libraryBooks={serverOrderedBooks}
        source='local'
        cloudBooksTotal={0}
      />,
    );

    const rendered = screen.getAllByTestId('book-item').map((el) => el.textContent);
    expect(rendered).toEqual(['book-aaa', 'book-zzz']);
  });
});
