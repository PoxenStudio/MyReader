/**
 * TranslatorPopup error message — regardless of provider or login state, a
 * failed translation should always show the generic "try again later"
 * message. The message used to branch on whether the user was logged in and
 * claim "please log in first", which was misleading for providers that never
 * required a login in the first place.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import TranslatorPopup from '@/app/reader/components/annotator/TranslatorPopup';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { translateTargetLang: 'EN', translationProvider: 'edge' } },
    setSettings: vi.fn(),
  }),
}));

const mockTranslate = vi.fn();
// Must be a stable reference — TranslatorPopup's effect depends on `translators`
// by identity, so a fresh array literal on every render would re-trigger the
// effect forever.
const mockTranslators = [{ name: 'edge', label: 'Edge Translator', disabled: false }];
vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mockTranslate,
    translators: mockTranslators,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderPopup = () =>
  render(
    <TranslatorPopup
      text='hello'
      position={{ point: { x: 0, y: 0 }, dir: 'up' }}
      trianglePosition={{ point: { x: 0, y: 0 }, dir: 'up' }}
      popupWidth={300}
      popupHeight={200}
    />,
  );

describe('TranslatorPopup translation failure message', () => {
  it('shows the generic retry message when logged in', async () => {
    mockUseAuth.mockReturnValue({ token: 'a-token' });
    mockTranslate.mockRejectedValue(new Error('Translation failed with status 500'));

    renderPopup();

    await waitFor(() => {
      expect(screen.getByText('Unable to fetch the translation. Try again later.')).toBeTruthy();
    });
  });

  it('shows the same generic retry message when logged out', async () => {
    mockUseAuth.mockReturnValue({ token: null });
    mockTranslate.mockRejectedValue(new Error('Failed to get auth token: 404'));

    renderPopup();

    await waitFor(() => {
      expect(screen.getByText('Unable to fetch the translation. Try again later.')).toBeTruthy();
    });
    expect(
      screen.queryByText('Unable to fetch the translation. Please log in first and try again.'),
    ).toBeNull();
  });
});
