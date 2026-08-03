import { create } from 'zustand';

interface NasDeviceState {
  /** Whether the global NAS re-login webview should be shown. */
  promptOpen: boolean;
  /**
   * Request the global NAS login prompt to open. A no-op while already
   * open — `fetchMyBooks` may call this once per request during a burst of
   * calls right after expiry, and we only want one webview.
   */
  requestPrompt: () => void;
  closePrompt: () => void;
}

export const useNasDeviceStore = create<NasDeviceState>((set, get) => ({
  promptOpen: false,
  requestPrompt: () => {
    if (get().promptOpen) return;
    set({ promptOpen: true });
  },
  closePrompt: () => set({ promptOpen: false }),
}));
