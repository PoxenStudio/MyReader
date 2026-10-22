import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));

const store = {
  viewStates: {} as Record<string, { ttsEnabled?: boolean }>,
};
vi.mock('@/store/readerStore', () => ({
  useReaderStore: <R,>(selector: (s: typeof store) => R) => selector(store),
}));

const previousLocationState = {
  location: null as string | null,
  handleBack: vi.fn(),
};
vi.mock('@/app/reader/hooks/useBackToPreviousLocation', () => ({
  useBackToPreviousLocation: () => previousLocationState,
}));

import BackToPreviousLocation from '@/app/reader/components/BackToPreviousLocation';

describe('BackToPreviousLocation', () => {
  beforeEach(() => {
    previousLocationState.location = null;
    previousLocationState.handleBack = vi.fn();
    store.viewStates = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('renders nothing while there is no previous location to return to', () => {
    render(<BackToPreviousLocation bookKey='b1' />);
    expect(screen.queryByText('Back to Previous Location')).toBeNull();
  });

  test('shows the pill and returns to the previous location when tapped', () => {
    previousLocationState.location = 'cfi-ch1';
    render(<BackToPreviousLocation bookKey='b1' />);

    fireEvent.click(screen.getByText('Back to Previous Location'));
    expect(previousLocationState.handleBack).toHaveBeenCalledTimes(1);
  });

  test('stays out of the way while a TTS session owns the spot', () => {
    previousLocationState.location = 'cfi-ch1';
    store.viewStates['b1'] = { ttsEnabled: true };
    render(<BackToPreviousLocation bookKey='b1' />);
    expect(screen.queryByText('Back to Previous Location')).toBeNull();
  });
});
