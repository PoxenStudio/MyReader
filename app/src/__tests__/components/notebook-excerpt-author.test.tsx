import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { BookNote } from '@/types/book';

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { customHighlightColors: {}, notebookWidth: '30%' } },
  }),
}));

let mockConfig: { booknotes: BookNote[] };

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ bookDoc: { metadata: { language: 'en' } } }),
    getConfig: () => mockConfig,
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViewsById: () => [],
    getProgress: () => null,
    getViewSettings: () => ({}),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book1' }),
}));

const notebookStoreState = {
  notebookWidth: '30%',
  isNotebookVisible: true,
  isNotebookPinned: false,
  notebookActiveTab: 'notes' as const,
  notebookNewAnnotation: null,
  notebookEditAnnotation: null,
  notebookNewHighlightId: null,
  setNotebookPin: vi.fn(),
  getNotebookWidth: () => '30%',
  setNotebookWidth: vi.fn(),
  setNotebookVisible: vi.fn(),
  toggleNotebookPin: vi.fn(),
  setNotebookNewAnnotation: vi.fn(),
  setNotebookNewHighlightId: vi.fn(),
  setNotebookEditAnnotation: vi.fn(),
  setNotebookActiveTab: vi.fn(),
};

vi.mock('@/store/notebookStore', () => {
  const useNotebookStore = () => notebookStoreState;
  useNotebookStore.getState = () => notebookStoreState;
  return { useNotebookStore };
});

vi.mock('@/store/aiChatStore', () => ({
  useAIChatStore: () => ({ activeConversationId: null }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    updateAppTheme: vi.fn(),
    safeAreaInsets: undefined,
    systemUIVisible: true,
    statusBarHeight: 0,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasRoundedWindow: false, isMobile: false } }),
}));

vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 1 },
    handleVerticalDragStart: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));

vi.mock('@/hooks/useShortcuts', () => ({ default: () => {} }));

vi.mock('@/utils/insets', () => ({ getPanelTopInset: () => 0 }));

vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  findAnnotationAtCfi: () => -1,
  removeBookNoteOverlays: vi.fn(),
  removeEmptyAnnotationPlaceholder: () => null,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/app/reader/components/notebook/AIAssistant', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NoteEditor', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTabNavigation', () => ({ default: () => null }));
vi.mock('@/app/reader/components/EmptyState', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BooknoteItem', () => ({ default: () => null }));

// The author avatar must be resolved via getMyBooksAvatarUrl() and rendered
// through the cookie-aware UserAvatar component, same pattern as BooknoteItem.
vi.mock('@/services/mybooksService', () => ({
  getMyBooksAvatarUrl: (avatar: string) => `resolved:${avatar}`,
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ url }: { url: string }) => <img data-testid='author-avatar' src={url} alt='' />,
}));

import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import Notebook from '@/app/reader/components/notebook/Notebook';

const makeExcerpt = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'x1',
  type: 'excerpt',
  cfi: 'epubcfi(/6/4!/4/2:0)',
  text: 'excerpted text',
  note: '',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('Notebook — Excerpts author badge for other users’ excerpts', () => {
  beforeEach(() => {
    useMyBooksStatusStore.setState({ currentUserId: 1 });
  });

  it('shows the nickname and resolved avatar for another user’s excerpt', () => {
    mockConfig = {
      booknotes: [
        makeExcerpt({
          userId: '99',
          author: { nickname: 'Alice', avatar: 'http://localhost:8082/avatar/reader.png' },
        }),
      ],
    };
    render(<Notebook />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByTestId('author-avatar').getAttribute('src')).toBe(
      'resolved:http://localhost:8082/avatar/reader.png',
    );
  });

  it('does not show an author badge for the current user’s own excerpt', () => {
    mockConfig = {
      booknotes: [makeExcerpt({ userId: '1', author: { nickname: 'Alice' } })],
    };
    render(<Notebook />);
    expect(screen.queryByText('Alice')).toBeNull();
  });
});
