import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BookNote } from '@/types/book';

/**
 * A book without MyNexus support has no AI companion. The annotation toolbar
 * and the notebook tab navigation already hide their AI-chat entries for these
 * books, but the persisted active tab can still be 'companion' — the notebook
 * must not render MyNexusChatPanel in that case and should fall back to notes.
 */

let mockCompanionAvailable = false;

vi.mock('@/store/myNexusStore', () => ({
  useMyNexusEnabled: () => true,
  useMyNexusAvailability: () => mockCompanionAvailable,
  useMyNexusStore: Object.assign(() => ({}), {
    getState: () => ({ pendingSelection: null, clearPendingSelection: vi.fn() }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        customHighlightColors: {},
        notebookWidth: '30%',
        isNotebookPinned: true,
      },
    },
  }),
}));

let mockConfig: { booknotes: BookNote[] };

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { bookId: 42 }, bookDoc: { metadata: { language: 'en' } } }),
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

vi.mock('@/app/reader/utils/globalAnnotations', () => ({
  expandAllRenderedSections: vi.fn(),
  removeGlobalAnnotationOverlays: vi.fn(),
}));

vi.mock('@/app/reader/utils/aiSelectionMarker', () => ({
  removeAiSelectionMarker: vi.fn(),
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
vi.mock('@/app/reader/components/mynexus/MyNexusChatPanel', () => ({
  default: () => <div data-testid='mynexus-chat-panel' />,
}));

vi.mock('@/services/mybooksService', () => ({
  getMyBooksAvatarUrl: (avatar: string) => avatar,
}));

import { useNotebookStore } from '@/store/notebookStore';
import Notebook from '@/app/reader/components/notebook/Notebook';

const excerpt: BookNote = {
  id: 'x1',
  type: 'excerpt',
  cfi: 'epubcfi(/6/4!/4/2:0)',
  text: 'excerpted text',
  note: '',
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  useNotebookStore.setState({
    notebookWidth: '30%',
    isNotebookVisible: true,
    isNotebookPinned: false,
    notebookActiveTab: 'companion',
    notebookNewAnnotation: null,
    notebookNewHighlightId: null,
    notebookEditAnnotation: null,
  });
  mockConfig = { booknotes: [excerpt] };
});

afterEach(() => {
  cleanup();
  mockCompanionAvailable = false;
});

describe('Notebook — companion tab gated on MyNexus support', () => {
  it('falls back to notes and does not render the companion panel when the book is unsupported', () => {
    mockCompanionAvailable = false;
    render(<Notebook />);

    expect(screen.queryByTestId('mynexus-chat-panel')).toBeNull();
    expect(screen.getAllByText('excerpted text').length).toBeGreaterThan(0);
  });

  it('renders the companion panel when the book supports MyNexus', () => {
    mockCompanionAvailable = true;
    render(<Notebook />);

    expect(screen.getByTestId('mynexus-chat-panel')).toBeTruthy();
  });
});
