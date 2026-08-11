import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { BookNote } from '@/types/book';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ viewSettings: {} }),
    setConfig: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn() }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ setSideBarVisible: vi.fn() }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

// Same pattern as BooknoteItem: avatar must go through getMyBooksAvatarUrl()
// and the cookie-aware UserAvatar component, not a raw <img src>.
vi.mock('@/services/mybooksService', () => ({
  getMyBooksAvatarUrl: (avatar: string) => `resolved:${avatar}`,
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ url }: { url: string }) => <img data-testid='author-avatar' src={url} alt='' />,
}));

import { initDayjs } from '@/utils/time'; // registers dayjs' relativeTime plugin, used by AnnotationNotes
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import AnnotationNotes from '@/app/reader/components/annotator/AnnotationNotes';

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

describe('AnnotationNotes — author badge for other users’ notes', () => {
  beforeEach(() => {
    useMyBooksStatusStore.setState({ currentUserId: 1 });
  });

  const renderNotes = (notes: BookNote[]) =>
    render(
      <AnnotationNotes
        bookKey='book-key'
        isVertical={false}
        notes={notes}
        toolsVisible={false}
        triangleDir='down'
        popupWidth={200}
        popupHeight={100}
        onDismiss={vi.fn()}
      />,
    );

  it('shows the nickname and resolved avatar for another user’s note', () => {
    renderNotes([
      makeNote({
        userId: '99',
        author: { nickname: 'Alice', avatar: 'http://localhost:8082/avatar/reader.png' },
      }),
    ]);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByTestId('author-avatar').getAttribute('src')).toBe(
      'resolved:http://localhost:8082/avatar/reader.png',
    );
  });

  it('does not show an author badge for the current user’s own note', () => {
    renderNotes([makeNote({ userId: '1', author: { nickname: 'Alice' } })]);
    expect(screen.queryByText('Alice')).toBeNull();
  });
});
