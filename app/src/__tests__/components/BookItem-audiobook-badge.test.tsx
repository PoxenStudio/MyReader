import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Book } from '@/types/book';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: {} }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ getBookByHash: vi.fn() }),
}));
vi.mock('@/components/BookCover', () => ({
  default: () => <div data-testid='cover' />,
}));

import BookItem from '@/app/library/components/BookItem';

const book: Book = {
  hash: 'cloud-1',
  format: 'EPUB',
  title: 'Dune',
  author: 'Frank Herbert',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  storageType: 'cloud',
} as unknown as Book;

const baseProps = {
  book,
  mode: 'grid' as const,
  coverFit: 'crop' as const,
  isSelectMode: false,
  bookSelected: false,
  transferProgress: null,
  handleBookUpload: vi.fn(),
  handleBookDownload: vi.fn(),
  showBookDetailsModal: vi.fn(),
  showAllFormatsBadge: true,
  showTimeRemaining: false,
};

describe('BookItem format badge on the audiobook shelf', () => {
  afterEach(() => cleanup());

  it('shows the format badge outside the audiobook shelf', () => {
    const { queryByText } = render(<BookItem {...baseProps} isAudiobookShelf={false} />);
    expect(queryByText('EPUB')).toBeTruthy();
  });

  it('hides the format badge on the audiobook shelf', () => {
    const { queryByText } = render(<BookItem {...baseProps} isAudiobookShelf={true} />);
    expect(queryByText('EPUB')).toBeNull();
  });
});
