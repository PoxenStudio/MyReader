// UI-only state for the global audiobook player: which surface is showing
// (the full sheet vs. the collapsed mini bar). Playback state itself lives
// in audiobookSessionManager (a plain EventTarget, not a zustand store) —
// this store only decides what the library page renders.
// See document/MyReader_Audiobook_Feature_Design.md §5.5.

import { create } from 'zustand';

interface AudiobookUIState {
  isSheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useAudiobookUIStore = create<AudiobookUIState>((set) => ({
  isSheetOpen: false,
  openSheet: () => set({ isSheetOpen: true }),
  closeSheet: () => set({ isSheetOpen: false }),
}));
