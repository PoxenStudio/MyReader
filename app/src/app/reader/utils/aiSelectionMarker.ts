import { removeBookNoteOverlays } from '@/app/reader/utils/annotatorUtil';
import { useSettingsStore } from '@/store/settingsStore';
import type { BookNote } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { uniqueId } from '@/utils/misc';
import type { TextSelection } from '@/utils/sel';

const markers = new Map<string, BookNote>();

export const addAiSelectionMarker = (
  view: FoliateView | null,
  bookKey: string,
  selection: TextSelection,
): BookNote | null => {
  if (!view || !selection.text) return null;
  const cfi = selection.cfi || view.getCFI(selection.index, selection.range);
  if (!cfi) return null;

  removeAiSelectionMarker(view, bookKey);

  const { highlightStyle, highlightStyles } =
    useSettingsStore.getState().settings.globalReadSettings;
  const note: BookNote = {
    id: `mynexus-quote-${uniqueId()}`,
    type: 'annotation',
    cfi,
    style: highlightStyle,
    color: highlightStyles[highlightStyle],
    text: selection.text,
    note: '',
    page: selection.page,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  view.addAnnotation(note);
  markers.set(bookKey, note);
  console.log(`[MyNexus] selection marker added book=${bookKey} cfi=${cfi}`);
  return note;
};

export const removeAiSelectionMarker = (view: FoliateView | null, bookKey: string): void => {
  const note = markers.get(bookKey);
  if (!note) return;
  removeBookNoteOverlays(view, note);
  markers.delete(bookKey);
  console.log(`[MyNexus] selection marker removed book=${bookKey} cfi=${note.cfi}`);
};
