import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailView from '@/components/metadata/BookDetailView';

// Regression: the Upload/Download affordances in the Book Details modal were
// gated backwards relative to their intent (and relative to the equivalent
// per-item context-menu logic in BookshelfItem.tsx):
//   - Upload used `!book.downloadedAt` instead of "not yet uploaded"
//     (`bookId === 0`), so an already-uploaded local book with no local
//     download timestamp could still show an Upload button.
//   - Download used `book.downloadedAt` (truthy) instead of `!book.downloadedAt`,
//     so a not-yet-downloaded cloud book — e.g. one still pending in the
//     "sync reading books" background download — showed NO way to download it
//     at all, which read as "downloadedAt never gets set" even though the
//     flag itself was fine.
// Upload should show for a local book that hasn't been uploaded yet;
// Download should show for a cloud book that hasn't been downloaded yet.

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: true,
      metadataDescriptionCollapsed: true,
    },
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: () => null,
}));

afterEach(() => cleanup());

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'EPUB',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bookId: 0,
    ...overrides,
  }) as Book;

describe('BookDetailView Upload/Download button availability', () => {
  it('shows Upload for a local book that has not been uploaded yet', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ storageType: 'local', bookId: 0 })}
        metadata={null}
        fileSize={1024}
        onUpload={onUpload}
      />,
    );
    expect(container.querySelector('button[title="Upload to MyBooks"]')).toBeTruthy();
  });

  it('hides Upload once the local book has already been uploaded (bookId set)', () => {
    const onUpload = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ storageType: 'local', bookId: 42 })}
        metadata={null}
        fileSize={1024}
        onUpload={onUpload}
      />,
    );
    expect(container.querySelector('button[title="Upload to MyBooks"]')).toBeNull();
  });

  it('shows Download for a cloud book that has not been downloaded yet', () => {
    const onDownload = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ storageType: 'cloud', downloadedAt: null })}
        metadata={null}
        fileSize={null}
        onDownload={onDownload}
      />,
    );
    expect(container.querySelector('button[title="Download Book"]')).toBeTruthy();
  });

  it('hides Download once the cloud book is already downloaded', () => {
    const onDownload = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ storageType: 'cloud', downloadedAt: Date.now() })}
        metadata={null}
        fileSize={1024}
        onDownload={onDownload}
      />,
    );
    expect(container.querySelector('button[title="Download Book"]')).toBeNull();
  });
});
