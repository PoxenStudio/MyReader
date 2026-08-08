import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

// Regression for the local-shelf select-mode toolbar: Open/Status/Details/Send
// were unconditionally disabled whenever the selection contained a *group*
// tile (e.g. a series/author/folder group) because their ids fail the
// `isMd5` check — those handlers used the raw selection instead of expanding
// group ids into the book hashes they represent (the way Delete/Upload
// already do). Local shelves group far more often than the cloud browse view
// (which is always a flat book list), which is why the bug reads as
// "local-only" in the field report.

let searchParamsValue = new URLSearchParams('groupBy=series');
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

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => ({ current: null }),
}));

const appServiceStub = {
  isMobile: true,
  hasContextMenu: false,
  isAndroidApp: true,
  isIOSApp: false,
  isMacOSApp: false,
  hasWindow: false,
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: appServiceStub }),
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
      libraryGroupBy: 'series',
      librarySortByAuto: true,
      librarySortBy2: 'none',
      libraryCoverFit: 'crop',
      libraryAutoColumns: true,
      libraryColumns: 4,
      openBookInNewWindow: false,
    },
  }),
}));

const navigateToReaderMock = vi.fn();
const showReaderWindowMock = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: (...args: unknown[]) => navigateToReaderMock(...args),
  showReaderWindow: (...args: unknown[]) => showReaderWindowMock(...args),
}));

let selectedIds: string[] = [];
const updateBooksMock = vi.fn();
const libraryStoreState = {
  setCurrentBookshelf: vi.fn(),
  setLibrary: vi.fn(),
  updateBooks: updateBooksMock,
  updateBook: vi.fn(),
  setSelectedBooks: vi.fn(),
  getSelectedBooks: () => selectedIds,
  toggleSelectedBook: vi.fn(),
  getGroupName: () => '',
};
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => libraryStoreState,
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
  default: () => null,
}));

const showDetailsBookMock = vi.fn();

vi.mock('@/app/library/components/SendToDeviceDialog', () => ({ default: () => null }));
vi.mock('@/app/library/components/GroupingModal', () => ({ default: () => null }));
vi.mock('@/app/library/components/SetStatusAlert', () => ({
  default: ({ onUpdateStatus }: { onUpdateStatus: (status: string) => void }) => (
    <button onClick={() => onUpdateStatus('finished')}>mark-finished</button>
  ),
}));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/DeleteConfirmAlert', () => ({ default: () => null }));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import Bookshelf from '@/app/library/components/Bookshelf';

afterEach(() => {
  cleanup();
  searchParamsValue = new URLSearchParams('groupBy=series');
  selectedIds = [];
  vi.clearAllMocks();
});

const makeBook = (hash: string, series: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  bookId: 0,
  storageType: 'local',
  metadata: { series } as Book['metadata'],
  ...overrides,
});

const baseProps = {
  isSelectMode: true,
  isSelectAll: false,
  isSelectNone: false,
  onScrollerRef: vi.fn(),
  handleImportBooks: vi.fn(),
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  handleBookDelete: vi.fn(),
  handleBookPurge: vi.fn(),
  handleSetSelectMode: vi.fn(),
  handleShowDetailsBook: showDetailsBookMock,
  handleLibraryNavigation: vi.fn(),
  booksTransferProgress: {},
};

describe('Bookshelf select-mode actions on a selected group (local shelf)', () => {
  it('resolves a multi-book group selection to its book hashes for Open/Status, but disables Details/Send', async () => {
    const book1 = makeBook('1'.repeat(32), 'Chronicles');
    const book2 = makeBook('2'.repeat(32), 'Chronicles');
    const { md5Fingerprint } = await import('@/utils/md5');
    selectedIds = [md5Fingerprint('series:Chronicles')];

    render(<Bookshelf {...baseProps} libraryBooks={[book1, book2]} source='local' />);

    const openButton = screen.getByText('Open').closest('button')!;
    const statusButton = screen.getByText('Status').closest('button')!;
    const detailsButton = screen.getByText('Details').closest('button')!;
    const sendButton = screen.getByText('Send').closest('button')!;

    expect(openButton.className).not.toContain('btn-disabled');
    expect(statusButton.className).not.toContain('btn-disabled');
    // A group resolving to more than one book has no single book to show
    // details for or hand to the OS share sheet.
    expect(detailsButton.className).toContain('btn-disabled');
    expect(sendButton.className).toContain('btn-disabled');

    fireEvent.click(openButton);
    expect(navigateToReaderMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([book1.hash, book2.hash]),
    );
  });

  it('enables Open/Status/Details/Send when the selected group resolves to exactly one book', async () => {
    const soloBook = makeBook('3'.repeat(32), 'Solo');
    const { md5Fingerprint } = await import('@/utils/md5');
    selectedIds = [md5Fingerprint('series:Solo')];

    render(<Bookshelf {...baseProps} libraryBooks={[soloBook]} source='local' />);

    const openButton = screen.getByText('Open').closest('button')!;
    const statusButton = screen.getByText('Status').closest('button')!;
    const detailsButton = screen.getByText('Details').closest('button')!;
    const sendButton = screen.getByText('Send').closest('button')!;

    expect(openButton.className).not.toContain('btn-disabled');
    expect(statusButton.className).not.toContain('btn-disabled');
    expect(detailsButton.className).not.toContain('btn-disabled');
    expect(sendButton.className).not.toContain('btn-disabled');

    fireEvent.click(detailsButton);
    expect(showDetailsBookMock).toHaveBeenCalledWith(
      expect.objectContaining({ hash: soloBook.hash }),
    );
  });

  it('resolves the group selection to its underlying books when updating reading status', async () => {
    const book1 = makeBook('4'.repeat(32), 'StatusGroup');
    const book2 = makeBook('5'.repeat(32), 'StatusGroup');
    const { md5Fingerprint } = await import('@/utils/md5');
    selectedIds = [md5Fingerprint('series:StatusGroup')];

    render(<Bookshelf {...baseProps} libraryBooks={[book1, book2]} source='local' />);

    fireEvent.click(screen.getByText('Status').closest('button')!);
    fireEvent.click(screen.getByText('mark-finished'));

    expect(updateBooksMock).toHaveBeenCalled();
    const updatedBooks = updateBooksMock.mock.calls[0]![1] as Book[];
    expect(updatedBooks.map((b) => b.hash).sort()).toEqual([book1.hash, book2.hash].sort());
    expect(updatedBooks.every((b) => b.readingStatus === 'finished')).toBe(true);
  });
});
