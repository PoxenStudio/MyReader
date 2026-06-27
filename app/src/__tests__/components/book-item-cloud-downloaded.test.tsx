import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Book } from '@/types/book';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' } }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { autoUpload: false } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const getBookByHashMock = vi.fn();
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ getBookByHash: getBookByHashMock }),
}));

import BookItem from '@/app/library/components/BookItem';

function createCloudBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'cloud-123-EPUB',
    format: 'EPUB',
    title: 'Cloud Book',
    author: 'Someone',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    storageType: 'cloud',
    downloadedAt: null,
    ...overrides,
  } as unknown as Book;
}

const noop = () => {};

describe('BookItem cloud-download affordance on the cloud bookshelf', () => {
  afterEach(() => {
    cleanup();
    getBookByHashMock.mockReset();
  });

  it('shows the download button when the default-format variant is not in the local library', () => {
    getBookByHashMock.mockReturnValue(undefined);
    const book = createCloudBook();

    render(
      <BookItem
        book={book}
        mode='grid'
        coverFit='crop'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={noop}
        handleBookDownload={noop}
        showBookDetailsModal={noop}
      />,
    );

    expect(document.querySelector('.show-cloud-button')).not.toBeNull();
  });

  it('hides the download button when the default-format variant is already downloaded locally', () => {
    getBookByHashMock.mockReturnValue(createCloudBook({ downloadedAt: Date.now() }));
    const book = createCloudBook();

    render(
      <BookItem
        book={book}
        mode='grid'
        coverFit='crop'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={noop}
        handleBookDownload={noop}
        showBookDetailsModal={noop}
      />,
    );

    expect(document.querySelector('.show-cloud-button')).toBeNull();
  });
});
