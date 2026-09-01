import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor as waitForWithOptions } from '@testing-library/react';

// Distinct translation for the voice persona name so a test failure here
// can only mean the current-voice caption skipped `_()` and fell back to
// the raw English key — regression coverage for the bug where the voice
// picker list translated names (`_(voice.name)`) but the main-view caption
// showing the *currently selected* voice did not.
const TRANSLATED_VOICE_NAME = '云健';
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => (key === 'Yunjian' ? TRANSLATED_VOICE_NAME : key),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
  useDefaultIconSize: () => 24,
}));

vi.mock('@/components/Dialog', () => ({
  default: ({
    isOpen,
    header,
    children,
  }: {
    isOpen: boolean;
    header?: React.ReactNode;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role='dialog'>
        {header}
        {children}
      </div>
    ) : null,
}));

const envConfig = {};
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig, appService: { hasHaptics: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => ({}),
    setViewSettings: vi.fn(),
  }),
}));

const settings = { globalViewSettings: { ttsRate: 1.0, ttsSentenceGap: 0.15 } };
const settingsState = { settings, setSettings: vi.fn(), saveSettings: vi.fn() };
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => settingsState, { getState: () => settingsState }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: vi.fn() }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 5' }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u' }, token: 'tok' }),
}));
vi.mock('@/app/reader/components/tts/TTSChaptersView', () => ({
  default: () => <div>chapters-view</div>,
}));

import TTSPlayerSheet from '@/app/reader/components/tts/TTSPlayerSheet';

const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

const voiceGroups = [
  {
    id: 'edge',
    name: 'Edge TTS',
    voices: [{ id: 'yunjian-id', name: 'Yunjian', lang: 'zh-CN', disabled: false }],
  },
];

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  bookKey: 'b1',
  isOpen: true,
  ttsLang: 'zh',
  isPlaying: true,
  hasTimeline: true,
  hasGapControl: false,
  timeoutOption: 0,
  timeoutTimestamp: 0,
  chapterRemainingSec: null as number | null,
  onClose: vi.fn(),
  onTogglePlay: vi.fn(),
  onBackward: vi.fn(),
  onForward: vi.fn(),
  onSetRate: vi.fn(),
  onSetSentenceGap: vi.fn(),
  onSetParagraphGap: vi.fn(),
  onGetVoices: vi.fn().mockResolvedValue(voiceGroups),
  onSetVoice: vi.fn(),
  onGetVoiceId: vi.fn().mockReturnValue('yunjian-id'),
  onSelectTimeout: vi.fn(),
  onSeek: vi.fn().mockResolvedValue(undefined),
  onSeekPreview: vi.fn(),
  onGetPlaybackInfo: vi
    .fn()
    .mockReturnValue({ position: 10, duration: 100, measuredFraction: 0.4 }),
  downloads: {
    supported: false,
    chapters: [],
    statuses: new Map(),
    cacheBytes: 0,
    download: { activeChapterKey: null, done: 0, total: 0 },
    downloadChapter: vi.fn().mockResolvedValue(undefined),
    downloadAll: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    statusOf: vi.fn().mockReturnValue('none'),
    refresh: vi.fn().mockResolvedValue(undefined),
  },
  activeSectionIndex: null as number | null,
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('TTSPlayerSheet — current voice caption translation', () => {
  test('translates the selected voice persona name on the main view', async () => {
    render(<TTSPlayerSheet {...makeProps()} />);

    expect(await waitFor(() => screen.getByText(TRANSLATED_VOICE_NAME))).toBeTruthy();
    expect(screen.queryByText('Yunjian')).toBeNull();
  });
});
