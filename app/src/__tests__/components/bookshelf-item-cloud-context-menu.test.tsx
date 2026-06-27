import { render, cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Book } from '@/types/book';

let capturedOnContextMenu: (() => void) | null = null;

vi.mock('@/hooks/useLongPress', () => ({
  useLongPress: (opts: { onContextMenu?: () => void }) => {
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
  useAuth: () => ({ user: { id: 'test-user' } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { hasContextMenu: true, isBookAvailable: async () => true },
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ updateBook: vi.fn(), getBookByHash: vi.fn() }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { openBookInNewWindow: false, localBooksDir: '' } }),
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({}),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const appendedTexts: string[] = vi.hoisted(() => []);
const popupMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {
    new: vi.fn().mockResolvedValue({
      append: (item: { text: string }) => appendedTexts.push(item.text),
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

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

import BookshelfItem from '@/app/library/components/BookshelfItem';
import { FILE_REVEAL_LABELS } from '@/utils/os';

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

describe('BookshelfItem context menu in the cloud bookshelf', () => {
  beforeEach(() => {
    capturedOnContextMenu = null;
    appendedTexts.length = 0;
    popupMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('hides Select/Group/Show-in-Finder/Delete when isCloudLibrary is true', async () => {
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
      />,
    );

    expect(capturedOnContextMenu).not.toBeNull();
    capturedOnContextMenu!();

    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).not.toContain('Select Book');
    expect(appendedTexts).not.toContain('Group Books');
    expect(appendedTexts).not.toContain('Delete');
    for (const label of Object.values(FILE_REVEAL_LABELS)) {
      expect(appendedTexts).not.toContain(label);
    }
  });

  it('keeps Select/Group/Show-in-Finder/Delete when isCloudLibrary is false', async () => {
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
        isCloudLibrary={false}
      />,
    );

    expect(capturedOnContextMenu).not.toBeNull();
    capturedOnContextMenu!();

    await waitFor(() => expect(popupMock).toHaveBeenCalled());

    expect(appendedTexts).toContain('Select Book');
    expect(appendedTexts).toContain('Group Books');
    expect(appendedTexts).toContain('Delete');
    expect(Object.values(FILE_REVEAL_LABELS).some((label) => appendedTexts.includes(label))).toBe(
      true,
    );
  });
});
