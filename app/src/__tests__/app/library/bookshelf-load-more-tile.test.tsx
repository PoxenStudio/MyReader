import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      libraryViewMode: 'grid',
      librarySortBy: 'updated',
      librarySortAscending: false,
      libraryGroupBy: 'none',
      librarySortByAuto: true,
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
  // on the trailing tile without a viewport-sized jsdom layout.
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
  // `groupBy: 'none'` in these tests never exercises the real grouping
  // helper, so a stub is enough to avoid pulling in BookshelfItem's heavy
  // (Tauri menu, router) dependencies.
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

const makeBook = (hash: string): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
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
  handleSetSelectMode: vi.fn(),
  handleShowDetailsBook: vi.fn(),
  handleLibraryNavigation: vi.fn(),
  booksTransferProgress: {},
};

describe('Bookshelf trailing Load More tile (cloud library)', () => {
  it('renders a pill-shaped Load More card after the last book in grid mode and wires it to onLoadMoreCloudBooks', () => {
    const onLoadMoreCloudBooks = vi.fn();
    render(
      <Bookshelf
        {...baseProps}
        libraryBooks={[makeBook('book1'), makeBook('book2')]}
        source='cloud'
        isCloudLibrary
        cloudBooksTotal={5}
        onLoadMoreCloudBooks={onLoadMoreCloudBooks}
      />,
    );

    expect(screen.getAllByTestId('book-item')).toHaveLength(2);

    const loadMoreButton = screen.getByRole('button', { name: /Load More/i });
    expect(loadMoreButton.textContent).toContain('Load More');
    expect(loadMoreButton.textContent).toContain('2/5');
    expect(loadMoreButton.className).toContain('rounded-full');

    fireEvent.click(loadMoreButton);
    expect(onLoadMoreCloudBooks).toHaveBeenCalledTimes(1);
  });

  it('does not render a Load More card once every cloud book has been loaded', () => {
    render(
      <Bookshelf
        {...baseProps}
        libraryBooks={[makeBook('book1'), makeBook('book2')]}
        source='cloud'
        isCloudLibrary
        cloudBooksTotal={2}
        onLoadMoreCloudBooks={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Load More/i })).toBeNull();
  });

  it('also renders the Load More card in list mode', () => {
    searchParamsValue = new URLSearchParams('view=list');
    const onLoadMoreCloudBooks = vi.fn();
    render(
      <Bookshelf
        {...baseProps}
        libraryBooks={[makeBook('book1')]}
        source='cloud'
        isCloudLibrary
        cloudBooksTotal={3}
        onLoadMoreCloudBooks={onLoadMoreCloudBooks}
      />,
    );

    const loadMoreButton = screen.getByRole('button', { name: /Load More/i });
    expect(loadMoreButton.textContent).toContain('1/3');

    fireEvent.click(loadMoreButton);
    expect(onLoadMoreCloudBooks).toHaveBeenCalledTimes(1);
  });
});
