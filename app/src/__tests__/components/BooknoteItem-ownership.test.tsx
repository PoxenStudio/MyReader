import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { BookNote } from '@/types/book';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { customHighlightColors: {} } },
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => null,
    getView: () => null,
    getViewsById: () => [],
    getViewSettings: () => undefined,
  }),
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    setNotebookEditAnnotation: vi.fn(),
    setNotebookVisible: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: [] }),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  removeBookNoteOverlays: vi.fn(),
}));

// The author avatar must be resolved via getMyBooksAvatarUrl() (host
// prefixing / web proxy) and fetched through UserAvatar (cookie-aware, so it
// works behind the MyBooks auth cookie in both Tauri and web) — the same
// pattern every other avatar in the app uses. A raw `<img src={avatar}>`
// silently fails to load cross-origin authenticated avatars.
vi.mock('@/services/mybooksService', () => ({
  getMyBooksAvatarUrl: (avatar: string) => `resolved:${avatar}`,
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ url }: { url: string }) => <img data-testid='author-avatar' src={url} alt='' />,
}));

import { initDayjs } from '@/utils/time'; // registers dayjs' relativeTime plugin, used by BooknoteItem
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import BooknoteItem from '@/app/reader/components/sidebar/BooknoteItem';

initDayjs('en');

const makeNote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2:0)',
  text: 'highlighted text',
  note: 'my note',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('BooknoteItem — ownership gating', () => {
  beforeEach(() => {
    useMyBooksStatusStore.setState({ currentUserId: 1 });
  });

  it('shows edit/delete for a note with no userId (local/own)', () => {
    render(<BooknoteItem bookKey='book-key' item={makeNote()} />);
    expect(screen.getByLabelText('Delete')).toBeTruthy();
    expect(screen.getByLabelText('Edit')).toBeTruthy();
  });

  it('shows edit/delete for a note owned by the current user', () => {
    render(<BooknoteItem bookKey='book-key' item={makeNote({ userId: '1' })} />);
    expect(screen.getByLabelText('Delete')).toBeTruthy();
    expect(screen.getByLabelText('Edit')).toBeTruthy();
  });

  it('hides edit/delete for a note owned by another user', () => {
    render(<BooknoteItem bookKey='book-key' item={makeNote({ userId: '99' })} />);
    expect(screen.queryByLabelText('Delete')).toBeNull();
    expect(screen.queryByLabelText('Edit')).toBeNull();
  });

  it('shows the author badge for another user’s note', () => {
    render(
      <BooknoteItem
        bookKey='book-key'
        item={makeNote({ userId: '99', author: { nickname: 'Alice' } })}
      />,
    );
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('does not show an author badge for the current user’s own note', () => {
    render(
      <BooknoteItem
        bookKey='book-key'
        item={makeNote({ userId: '1', author: { nickname: 'Alice' } })}
      />,
    );
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('resolves the author avatar via getMyBooksAvatarUrl and renders it through UserAvatar', () => {
    render(
      <BooknoteItem
        bookKey='book-key'
        item={makeNote({
          userId: '99',
          author: { nickname: 'Alice', avatar: 'http://localhost:8082/avatar/reader.png' },
        })}
      />,
    );
    expect(screen.getByTestId('author-avatar').getAttribute('src')).toBe(
      'resolved:http://localhost:8082/avatar/reader.png',
    );
  });
});
