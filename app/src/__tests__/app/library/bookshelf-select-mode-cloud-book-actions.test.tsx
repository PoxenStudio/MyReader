import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

// Regression: cloud-synced books that live on the regular (local) bookshelf
// — including ones already fully downloaded — carry a `cloud-<id>-<format>`
// hash (see `buildCloudBookHash`), not a partial-MD5 one, because their
// identity has to stay stable across formats/re-downloads. The select-mode
// toolbar gated Open/Status/Details/Send on every selected id being
// MD5-shaped, which permanently disabled those actions for any such book
// regardless of whether it was actually available locally. Availability
// should depend on the book being selected on the local shelf, not on the
// shape of its hash.

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

const navigateToReaderMock = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: (...args: unknown[]) => navigateToReaderMock(...args),
  showReaderWindow: vi.fn(),
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
  searchParamsValue = new URLSearchParams();
  selectedIds = [];
  vi.clearAllMocks();
});

// A cloud-synced book that has already been fully downloaded and is sitting
// on the regular local bookshelf — same shape `useAutoSyncReadingBooks` and
// the cloud-book download path leave behind (hash never becomes an MD5).
const makeDownloadedCloudBook = (id: number): Book => ({
  hash: `cloud-${id}-epub`,
  format: 'EPUB',
  title: `Cloud Book ${id}`,
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  bookId: id,
  storageType: 'cloud',
  downloadedAt: Date.now(),
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

describe('Bookshelf select-mode actions on a selected cloud-synced book (local shelf)', () => {
  it('enables Open/Status/Details/Send for a downloaded cloud-synced book, not just plain-MD5-hash local books', () => {
    const book = makeDownloadedCloudBook(1);
    selectedIds = [book.hash];

    render(<Bookshelf {...baseProps} libraryBooks={[book]} source='local' />);

    const openButton = screen.getByText('Open').closest('button')!;
    const statusButton = screen.getByText('Status').closest('button')!;
    const detailsButton = screen.getByText('Details').closest('button')!;
    const sendButton = screen.getByText('Send').closest('button')!;

    expect(openButton.className).not.toContain('btn-disabled');
    expect(statusButton.className).not.toContain('btn-disabled');
    expect(detailsButton.className).not.toContain('btn-disabled');
    expect(sendButton.className).not.toContain('btn-disabled');

    fireEvent.click(openButton);
    expect(navigateToReaderMock).toHaveBeenCalledWith(expect.anything(), [book.hash]);
  });

  it('resolves Details/Status to the selected cloud-synced book', () => {
    const book = makeDownloadedCloudBook(2);
    selectedIds = [book.hash];

    render(<Bookshelf {...baseProps} libraryBooks={[book]} source='local' />);

    fireEvent.click(screen.getByText('Details').closest('button')!);
    expect(showDetailsBookMock).toHaveBeenCalledWith(expect.objectContaining({ hash: book.hash }));

    fireEvent.click(screen.getByText('Status').closest('button')!);
    fireEvent.click(screen.getByText('mark-finished'));
    expect(updateBooksMock).toHaveBeenCalled();
    const updatedBooks = updateBooksMock.mock.calls[0]![1] as Book[];
    expect(updatedBooks.map((b) => b.hash)).toEqual([book.hash]);
  });
});
