import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

let appService: { isIOSApp: boolean } | null = { isIOSApp: false };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

const nasSettings = { enabled: true, loginUrl: 'https://nas.example.com/login' };
const settingsState = {
  settings: { nas: nasSettings },
  setSettings: vi.fn(),
  saveSettings: vi.fn(),
};
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(settingsState) : settingsState),
    { getState: () => settingsState },
  ),
}));

vi.mock('@/store/nasDeviceStore', () => ({
  useNasDeviceStore: (selector: (s: unknown) => unknown) =>
    selector({ promptOpen: true, closePrompt: vi.fn() }),
}));

vi.mock('@/components/nas/NasRemoteWebview', () => ({
  __esModule: true,
  default: () => <div data-testid='nas-webview' />,
}));

import NasSessionPrompt from '@/components/nas/NasSessionPrompt';

describe('NasSessionPrompt mobile gating', () => {
  afterEach(() => {
    cleanup();
    appService = { isIOSApp: false };
  });

  it('renders the webview on Android (no close-button gap)', () => {
    appService = { isIOSApp: false };
    const { getByTestId } = render(<NasSessionPrompt />);
    expect(getByTestId('nas-webview')).toBeTruthy();
  });

  it('stays hidden on iOS (no native close button exists yet)', () => {
    appService = { isIOSApp: true };
    const { container } = render(<NasSessionPrompt />);
    expect(container.firstChild).toBeNull();
  });
});
