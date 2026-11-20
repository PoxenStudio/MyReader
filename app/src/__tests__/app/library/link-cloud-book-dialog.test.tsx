import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Book } from '@/types/book';
import type { MyBooksBook } from '@/services/mybooksService';

const searchBooksSpy = vi.hoisted(() => vi.fn());
vi.mock('@/services/mybooksService', () => ({
  searchBooks: searchBooksSpy,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, unknown>) =>
    options ? key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options[name])) : key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

const updateBookSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({
    updateBook: updateBookSpy,
    getBookByHash: () => undefined,
  }),
}));

const dispatchSpy = vi.hoisted(() => vi.fn());
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: dispatchSpy },
}));

vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/BookCover', () => ({
  default: () => <div data-testid='cover' />,
}));

import LinkCloudBookDialog from '@/app/library/components/LinkCloudBookDialog';

const localBook: Book = {
  hash: 'local-1',
  format: 'EPUB',
  title: 'Test Book',
  author: 'Local Author',
  createdAt: 0,
  updatedAt: 0,
  bookId: 0,
  storageType: 'local',
};

const cloudBook = {
  id: 42,
  title: 'Cloud Title',
  author: 'Cloud Author',
  img: '',
  thumb: '',
  rating: 0,
  tags: [],
  languages: [],
  files: [{ format: 'epub', size: 1, href: '/api/book/42.epub' }],
  state: { read_state: 0 },
} as unknown as MyBooksBook;

const onClose = vi.fn();

const renderDialog = () =>
  render(<LinkCloudBookDialog isOpen book={localBook} onClose={onClose} />);

describe('LinkCloudBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('searches MyBooks by the local book title and lists cover, title and author', async () => {
    searchBooksSpy.mockResolvedValue({ books: [cloudBook], total: 1 });

    renderDialog();

    await waitFor(() => expect(searchBooksSpy).toHaveBeenCalledWith('Test Book', 1, 30));
    expect(await screen.findByText('Cloud Title')).toBeTruthy();
    expect(screen.getByText('Cloud Author')).toBeTruthy();
    expect(screen.getByTestId('cover')).toBeTruthy();
  });

  it('links the selected cloud book by setting bookId and closing', async () => {
    searchBooksSpy.mockResolvedValue({ books: [cloudBook], total: 1 });

    renderDialog();

    fireEvent.click(await screen.findByText('Cloud Title'));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(updateBookSpy).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ hash: 'local-1', bookId: 42 }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'success' }));
  });

  it('shows a localized error when the search fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    searchBooksSpy.mockRejectedValue(new Error('boom'));

    renderDialog();

    expect(await screen.findByText('Failed to search cloud books')).toBeTruthy();
    errorSpy.mockRestore();
  });

  it('asks the user to sign in when the session has expired', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    searchBooksSpy.mockRejectedValue({ err: 'user.need_login' });

    renderDialog();

    expect(await screen.findByText('Sign in to link cloud books')).toBeTruthy();
    errorSpy.mockRestore();
  });

  it('shows an empty state when the search has no results', async () => {
    searchBooksSpy.mockResolvedValue({ books: [], total: 0 });

    renderDialog();

    expect(await screen.findByText('No matching books found')).toBeTruthy();
  });
});
