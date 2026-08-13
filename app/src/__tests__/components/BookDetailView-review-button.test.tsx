import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailView from '@/components/metadata/BookDetailView';

// Mirrors the gating BookshelfItem.tsx applies to its "Write a Review"
// context-menu item: only cloud-bookshelf books with a resolvable MyBooks
// book id, only while the server allows reviews, only on the Tauri app
// (mybooks review is not offered on the web build), and only for a signed-in
// user (the button itself is hidden rather than prompting to sign in).

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

const { reviewAllowed, isTauri, currentUser } = vi.hoisted(() => ({
  reviewAllowed: { current: true },
  isTauri: { current: true },
  currentUser: { current: { id: 'u1' } as { id: string } | null },
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksBookReviewAllowed: () => reviewAllowed.current,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => isTauri.current,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: currentUser.current }),
}));

afterEach(() => {
  cleanup();
  reviewAllowed.current = true;
  isTauri.current = true;
  currentUser.current = { id: 'u1' };
});

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'EPUB',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    storageType: 'cloud',
    bookId: 42,
    ...overrides,
  }) as Book;

describe('BookDetailView review button availability', () => {
  it('shows the review icon for a cloud book with a book id when reviews are allowed and onReview is provided', () => {
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView book={makeBook()} metadata={null} fileSize={null} onReview={onReview} />,
    );
    const button = container.querySelector('button[title="Write a Review"]');
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('hides the review icon when onReview is not provided', () => {
    const { container } = render(
      <BookDetailView book={makeBook()} metadata={null} fileSize={null} />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });

  it('hides the review icon for a local (non-cloud) book', () => {
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ storageType: 'local' })}
        metadata={null}
        fileSize={1024}
        onReview={onReview}
      />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });

  it('hides the review icon for a cloud book with no MyBooks book id', () => {
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView
        book={makeBook({ bookId: 0 })}
        metadata={null}
        fileSize={null}
        onReview={onReview}
      />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });

  it('hides the review icon when the server disallows reviews', () => {
    reviewAllowed.current = false;
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView book={makeBook()} metadata={null} fileSize={null} onReview={onReview} />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });

  it('hides the review icon outside the Tauri app', () => {
    isTauri.current = false;
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView book={makeBook()} metadata={null} fileSize={null} onReview={onReview} />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });

  it('hides the review icon when the user is signed out', () => {
    currentUser.current = null;
    const onReview = vi.fn();
    const { container } = render(
      <BookDetailView book={makeBook()} metadata={null} fileSize={null} onReview={onReview} />,
    );
    expect(container.querySelector('button[title="Write a Review"]')).toBeNull();
  });
});
