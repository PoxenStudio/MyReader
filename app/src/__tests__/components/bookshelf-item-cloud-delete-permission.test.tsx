import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Book } from '@/types/book';

let capturedOnContextMenu: ((e: { clientX: number; clientY: number }) => void) | null = null;

vi.mock('@/hooks/useLongPress', () => ({
  useLongPress: (opts: { onContextMenu?: (e: { clientX: number; clientY: number }) => void }) => {
    capturedOnContextMenu = opts.onContextMenu ?? null;
    return { pressing: false, handlers: {} };
  },
}));

vi.mock('@/utils/nav', () => ({
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
  navigateToLogin: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' }, isAdmin: true }),
}));

const isBookAvailableMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      hasContextMenu: true,
      isBookAvailable: (...args: unknown[]) => isBookAvailableMock(...args),
    },
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ updateBook: vi.fn(), getBookByHash: vi.fn() }),
}));

const settingsMock = vi.hoisted(() => ({ allowDelCloudBook: true }));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { openBookInNewWindow: false, localBooksDir: '', ...settingsMock },
  }),
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({}),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const appendedTexts: string[] = vi.hoisted(() => []);
type AppendedMenuItem = { text: string; action?: () => unknown; items?: AppendedMenuItem[] };
const appendedItems: AppendedMenuItem[] = vi.hoisted(() => []);
const popupMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {
    new: vi.fn().mockResolvedValue({
      append: (item: AppendedMenuItem) => {
        appendedTexts.push(item.text);
        appendedItems.push(item);
      },
      popup: popupMock,
    }),
  },
  MenuItem: {
    new: vi.fn().mockImplementation(async (opts: { text: string }) => opts),
  },
  Submenu: {
    new: vi.fn().mockImplementation(async (opts: { text: string }) => opts),
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 1280, height: 800 }),
    scaleFactor: async () => 1,
  }),
  LogicalPosition: class {
    readonly type = 'Logical';
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

import BookshelfItem from '@/app/library/components/BookshelfItem';

const cloudBook: Book = {
  hash: 'cloud-123',
  format: 'EPUB',
  title: 'Cloud Book',
  author: 'Someone',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  storageType: 'cloud',
} as unknown as Book;

describe('BookshelfItem cloud delete permission', () => {
  beforeEach(() => {
    capturedOnContextMenu = null;
    appendedTexts.length = 0;
    appendedItems.length = 0;
    popupMock.mockClear();
    settingsMock.allowDelCloudBook = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('hides Delete for admins in the cloud bookshelf when allowDelCloudBook is false', async () => {
    settingsMock.allowDelCloudBook = false;

    render(
      <BookshelfItem
        mode='grid'
        item={cloudBook}
        coverFit='crop'
        isSelectMode={false}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDownload={vi.fn()}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
        isCloudLibrary={true}
        showTimeRemaining={false}
      />,
    );

    expect(capturedOnContextMenu).not.toBeNull();
    capturedOnContextMenu!({ clientX: 0, clientY: 0 });

    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).not.toContain('Delete');
  });

  it('shows Delete for admins in the cloud bookshelf when allowDelCloudBook is true', async () => {
    settingsMock.allowDelCloudBook = true;

    render(
      <BookshelfItem
        mode='grid'
        item={cloudBook}
        coverFit='crop'
        isSelectMode={false}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        toggleSelection={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDownload={vi.fn()}
        handleBookUpload={vi.fn()}
        handleBookDelete={vi.fn()}
        handleSetSelectMode={vi.fn()}
        handleShowDetailsBook={vi.fn()}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
        isCloudLibrary={true}
        showTimeRemaining={false}
      />,
    );

    expect(capturedOnContextMenu).not.toBeNull();
    capturedOnContextMenu!({ clientX: 0, clientY: 0 });

    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).toContain('Delete');
  });
});
