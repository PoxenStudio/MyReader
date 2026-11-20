import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';

const appendSpy = vi.hoisted(() => vi.fn());
const popupSpy = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() =>
  vi.fn(async () => ({ popup: popupSpy, close: vi.fn(async () => {}), append: appendSpy })),
);

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
  MenuItem: { new: vi.fn(async (opts) => opts) },
  Submenu: { new: vi.fn(async (opts) => opts) },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 1024, height: 768 }),
    scaleFactor: async () => 1,
  }),
  LogicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { hasContextMenu: true, isAndroidApp: false, isMobileApp: false },
  }),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }));
vi.mock('@/store/mybooksStatusStore', () => ({ useMyBooksBookReviewAllowed: () => false }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => ({}) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { localBooksDir: '/books' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook: vi.fn() }) }));
vi.mock('@/app/library/components/BookItem', () => ({ default: () => null }));
vi.mock('@/app/library/components/GroupItem', () => ({ default: () => null }));

const updateBookSpy = vi.hoisted(() => vi.fn());
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ getBookByHash: () => undefined, updateBook: updateBookSpy }),
}));

const dispatchSpy = vi.hoisted(() => vi.fn());
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: dispatchSpy } }));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;

const localBook: Book = {
  hash: 'local-1',
  format: 'EPUB',
  title: 'Local Book',
  author: 'Author',
  createdAt: 0,
  updatedAt: 0,
  bookId: 0,
  storageType: 'local',
};

const baseProps = {
  mode: 'grid' as const,
  coverFit: 'crop' as const,
  isSelectMode: false,
  itemSelected: false,
  transferProgress: null,
  setLoading: vi.fn(),
  toggleSelection: vi.fn(),
  handleGroupBooks: vi.fn(),
  handleBookDownload: vi.fn(async () => true),
  handleBookUpload: vi.fn(async () => true),
  handleBookDelete: vi.fn(async () => true),
  handleSetSelectMode: vi.fn(),
  handleShowDetailsBook: vi.fn(),
  handleLibraryNavigation: vi.fn(),
  handleUpdateReadingStatus: vi.fn(),
  showTimeRemaining: false,
};

const appendedItems = () =>
  appendSpy.mock.calls.map(([item]) => item as { text: string; action: () => Promise<void> });

describe('Link Cloud Book context menu item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('sits right below Upload Book for local books that are not linked yet', async () => {
    render(<BookshelfItem {...baseProps} item={localBook} />);

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Local Book' }));

    await waitFor(() =>
      expect(appendedItems().map((item) => item.text)).toContain('Link Cloud Book'),
    );
    const texts = appendedItems().map((item) => item.text);
    expect(texts.indexOf('Link Cloud Book')).toBe(texts.indexOf('Upload Book') + 1);
  });

  it('asks the bookshelf to open the link dialog for that book', async () => {
    render(<BookshelfItem {...baseProps} item={localBook} />);

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Local Book' }));
    await waitFor(() =>
      expect(appendedItems().map((item) => item.text)).toContain('Link Cloud Book'),
    );

    const menuItem = appendedItems().find((item) => item.text === 'Link Cloud Book')!;
    await menuItem.action();

    expect(dispatchSpy).toHaveBeenCalledWith('show-link-cloud-book-dialog', {
      book: localBook,
    });
  });
});
