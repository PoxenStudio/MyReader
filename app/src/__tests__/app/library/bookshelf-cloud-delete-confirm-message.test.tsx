import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

let searchParamsValue = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, unknown>) =>
    options ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name])) : key,
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
  generateBookshelfItems: vi.fn(),
  default: ({ item }: { item: { hash?: string; id?: string } }) => (
    <div data-testid='book-item'>{'hash' in item ? item.hash : item.id}</div>
  ),
}));

vi.mock('@/app/library/components/SelectModeActions', () => ({ default: () => null }));
vi.mock('@/app/library/components/SendToDeviceDialog', () => ({ default: () => null }));
vi.mock('@/app/library/components/GroupingModal', () => ({ default: () => null }));
vi.mock('@/app/library/components/SetStatusAlert', () => ({ default: () => null }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

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
  handleBookPurge: vi.fn(),
  handleSetSelectMode: vi.fn(),
  handleShowDetailsBook: vi.fn(),
  handleLibraryNavigation: vi.fn(),
  booksTransferProgress: {},
};

describe('Bookshelf multi-select delete confirmation message', () => {
  it('mentions MyBooks when deleting from the cloud shelf', async () => {
    render(
      <Bookshelf {...baseProps} libraryBooks={[makeBook('book1')]} source='cloud' isCloudLibrary />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('delete-books', { ids: ['book1'] });
    });

    expect(
      screen.getByText(
        'Are you sure to delete {{count}} selected book(s) from MyBooks?'.replace('{{count}}', '1'),
      ),
    ).toBeTruthy();
  });

  it('does not mention MyBooks when deleting from the local shelf', async () => {
    render(<Bookshelf {...baseProps} libraryBooks={[makeBook('book1')]} source='local' />);

    await act(async () => {
      await eventDispatcher.dispatch('delete-books', { ids: ['book1'] });
    });

    expect(
      screen.getByText(
        'Are you sure to delete {{count}} selected book(s)?'.replace('{{count}}', '1'),
      ),
    ).toBeTruthy();
  });
});
