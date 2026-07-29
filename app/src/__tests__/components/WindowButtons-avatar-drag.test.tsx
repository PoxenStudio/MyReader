import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(),
  TauriEvent: { WINDOW_FOCUS: 'tauri://focus' },
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  type: vi.fn(),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar: true } }),
}));

import { getCurrentWindow } from '@tauri-apps/api/window';
import WindowButtons from '@/components/WindowButtons';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Reproduces LibraryHeader's account/avatar button: a plain <button> sitting
// directly inside the `.titlebar` element, rendered without the `.btn` or
// `.exclude-title-bar-mousedown` class that WindowButtons' mousedown handler
// checks for before starting a native window drag.
const Harness = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={headerRef} className='titlebar'>
      <button
        aria-label='Account'
        className='exclude-title-bar-mousedown flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-base-200 h-7 w-7'
      >
        avatar
      </button>
      <WindowButtons headerRef={headerRef} />
    </div>
  );
};

describe('WindowButtons title-bar drag exclusion', () => {
  it('does not start a native window drag when mousedown lands on the account/avatar button', async () => {
    const startDragging = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({
      startDragging,
      toggleMaximize: vi.fn(),
    } as unknown as ReturnType<typeof getCurrentWindow>);

    render(<Harness />);

    fireEvent.mouseDown(screen.getByLabelText('Account'), { buttons: 1 });

    // handleMouseDown dynamically imports '@tauri-apps/api/window' before
    // calling startDragging(); flush that microtask before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(startDragging).not.toHaveBeenCalled();
  });
});
