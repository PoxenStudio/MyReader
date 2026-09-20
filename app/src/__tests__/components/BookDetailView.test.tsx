import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailView from '@/components/metadata/BookDetailView';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: false,
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

// The action row is gated on auth/review/platform state; these mirror the
// mocks BookDetailView-review-button.test.tsx uses.
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/store/mybooksStatusStore', () => ({
  useMyBooksBookReviewAllowed: () => true,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

afterEach(() => cleanup());

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'EPUB',
    coverImageUrl: 'https://example.com/cover.jpg',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    downloadedAt: Date.now(),
    uploadedAt: Date.now(),
    ...overrides,
  }) as Book;

const renderView = (extra?: Partial<React.ComponentProps<typeof BookDetailView>>) =>
  render(
    <BookDetailView
      book={makeBook()}
      metadata={null}
      fileSize={1024}
      onDelete={vi.fn()}
      {...extra}
    />,
  );

// The delete dropdown (and with it the More menu and the purge menu item) moved
// to the bookshelf context menu; what is left on the detail view is a single
// icon button that opens the delete confirmation alert.
describe('BookDetailView delete button', () => {
  it('calls onDelete when the delete button is clicked', () => {
    const onDelete = vi.fn();
    const { container } = renderView({ onDelete });

    const del = container.querySelector('button[title="Delete Book"]');
    expect(del).toBeTruthy();
    fireEvent.click(del!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // Fork-specific: the cloud bookshelf only lets an admin delete the shared
  // catalog entry, so the delete action as a whole is disabled for everyone
  // else rather than exposing per-option gating.
  it('disables the delete button when deleteDisabled is true', () => {
    const onDelete = vi.fn();
    const { container } = renderView({ onDelete, deleteDisabled: true });

    const del = container.querySelector('button[title="Delete Book"]');
    expect(del).toBeTruthy();
    expect(del!.className).toContain('btn-disabled');

    fireEvent.click(del!);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('omits the delete button when no onDelete handler is given', () => {
    const { container } = renderView({ onDelete: undefined });

    expect(container.querySelector('button[title="Delete Book"]')).toBeNull();
  });
});

describe('BookDetailView export button', () => {
  it('calls onExport when the export button is clicked', () => {
    const onExport = vi.fn();
    const { container } = renderView({ onExport });

    const exportButton = container.querySelector('button[title="Export Book"]');
    expect(exportButton).toBeTruthy();
    fireEvent.click(exportButton!);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  // Export is a plain button now: the caller decides whether to offer it at
  // all (the disabled-when-no-local-file state lived in the removed More menu).
  it('omits the export button when the book has no local copy', () => {
    const { container } = renderView({
      onExport: vi.fn(),
      book: makeBook({ downloadedAt: undefined }),
    });

    expect(container.querySelector('button[title="Export Book"]')).toBeNull();
  });
});

describe('BookDetailView metadata section', () => {
  it('renders the metadata grid when the section is expanded', () => {
    const { getByText } = renderView({ metadata: null, fileSize: 1024 });

    expect(getByText('Metadata')).toBeTruthy();
    expect(getByText('File Size')).toBeTruthy();
  });
});
