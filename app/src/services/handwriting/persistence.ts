import * as CFI from 'foliate-js/epubcfi.js';
import type { BookNote } from '@/types/book';
import { HandwritingEditor } from './editor';
import type { InkPage, InkStroke } from './model';
import { fixedPageKey, parsePageKey, sectionPageKey } from './pageKey';

/**
 * Handwriting is stored as `ink` booknotes: everything drawn in one session
 * of drawing mode is one annotation, listed in the sidebar like any other.
 * Each stroke keeps its own place: its text anchor in a reflowable book, its
 * page in a fixed-layout one. The editor works on page keys in memory; these
 * convert between the two.
 */

/** The spine index a CFI points into. */
const sectionOf = (cfi: string): number | null => {
  try {
    const parts = CFI.parse(cfi);
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
};

/** Ink as JSON with sorted keys: the server's jsonb hands strokes back in its own key order. */
const inkJson = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

// Stroke arrays are immutable until edited, so their canonical JSON can be
// reused across commits instead of re-serializing every drawing in the book.
const inkJsonCache = new WeakMap<object, string>();
const inkJsonOf = (value: unknown): string => {
  if (!value || typeof value !== 'object') return inkJson(value);
  const cached = inkJsonCache.get(value);
  if (cached !== undefined) return cached;
  const json = inkJson(value);
  inkJsonCache.set(value, json);
  return json;
};

export const loadInkEditor = (
  notes: BookNote[],
  fixedLayout: boolean,
  /** Drawings are private: shared notes from other readers are not loaded. */
  ownerId?: string,
): HandwritingEditor => {
  const pages: Record<string, InkPage> = {};
  const loadedNoteIds = new Set<string>();
  for (const note of notes) {
    if (note.type !== 'ink' || note.deletedAt || !note.ink?.length) continue;
    if (ownerId && note.userId && note.userId !== ownerId) continue;
    // Place every stroke or none: rewriting a note from a partial load would
    // drop the strokes whose anchor this reader could not resolve.
    const placed: { key: string; stroke: InkStroke }[] = [];
    for (const stroke of note.ink) {
      const index = fixedLayout
        ? (stroke.page ?? sectionOf(note.cfi))
        : sectionOf(stroke.anchor ?? note.cfi);
      if (index === null) {
        placed.length = 0;
        break;
      }
      placed.push({ key: fixedLayout ? fixedPageKey(index) : sectionPageKey(index), stroke });
    }
    if (!placed.length) continue;
    loadedNoteIds.add(note.id);
    for (const { key, stroke } of placed) {
      const page = (pages[key] ??= { strokes: [], updatedAt: note.updatedAt });
      page.strokes.push({ ...stroke, session: note.id });
      page.updatedAt = Math.max(page.updatedAt, note.updatedAt);
    }
  }
  const editor = new HandwritingEditor(pages);
  editor.loadedNoteIds = loadedNoteIds;
  return editor;
};

export interface InkNoteContext {
  /** The CFI of a section, for page-level (fixed layout or unanchored) ink. */
  cfiOf: (sectionIndex: number) => string;
  /** The text a drawing marks, shown in the sidebar. */
  describe: (cfi: string) => string;
  now?: number;
}

/**
 * The booknotes with the editor's ink written in: one `ink` note per drawing
 * session, placed at its first stroke, kept as is when its ink didn't change,
 * and tombstoned once its ink is gone so the deletion syncs.
 */
export const withInkNotes = (
  notes: BookNote[],
  editor: HandwritingEditor,
  { cfiOf, describe, now = Date.now() }: InkNoteContext,
): BookNote[] => {
  const sessions = new Map<string, { strokes: InkStroke[]; cfi: string; page?: number }>();
  for (const key of editor.pageKeys()) {
    const parsed = parsePageKey(key);
    if (!parsed) continue;
    const fixed = parsed.kind === 'page';
    for (const { session, page: _page, ...stroke } of editor.strokes(key)) {
      const id = session ?? `ink-${stroke.id}`;
      let group = sessions.get(id);
      if (!group) {
        let cfi = !fixed && stroke.anchor ? stroke.anchor : '';
        if (!cfi) {
          try {
            cfi = cfiOf(parsed.index);
          } catch {
            // A stale page index (or a teardown race) must not abort the save;
            // the fake CFI still locates the section.
            cfi = '';
          }
          if (!cfi) cfi = CFI.fake.fromIndex(parsed.index);
        }
        group = { strokes: [], cfi, ...(fixed ? { page: parsed.index + 1 } : {}) };
        sessions.set(id, group);
      }
      group.strokes.push(fixed ? { ...stroke, page: parsed.index } : stroke);
    }
  }

  const previous = new Map(notes.filter((n) => n.type === 'ink').map((n) => [n.id, n]));
  const result = notes.filter((n) => n.type !== 'ink');
  for (const [id, { strokes, cfi, page }] of sessions) {
    const prev = previous.get(id);
    previous.delete(id);
    if (prev && !prev.deletedAt && inkJsonOf(prev.ink) === inkJsonOf(strokes)) {
      result.push(prev);
      continue;
    }
    result.push({
      // Keep ownership and book fields a pulled note carries: rewriting a
      // note must not turn someone else's drawing into this user's own.
      ...prev,
      id,
      type: 'ink',
      cfi,
      ...(page ? { page } : {}),
      text: (prev?.cfi === cfi && prev.text) || describe(cfi),
      note: prev?.note ?? '',
      ink: strokes,
      // Drawing again over a tombstoned id resurrects the note.
      deletedAt: null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }
  const loaded = editor.loadedNoteIds;
  for (const gone of previous.values()) {
    // Only ink this editor actually loaded can be inferred deleted. A note
    // that arrived while the editor was open, or one whose strokes could not
    // be placed, is preserved untouched (tombstoning it would delete it on
    // every device through sync).
    if (loaded && !loaded.has(gone.id)) {
      result.push(gone);
      continue;
    }
    result.push(gone.deletedAt ? gone : { ...gone, ink: [], deletedAt: now, updatedAt: now });
  }
  return result;
};

/**
 * The book's ink as drawn, to tell outside edits from our own. Stamps are left
 * out: sync restamps a drawing it pushed without changing its strokes, and
 * reloading for that would drop the stroke being drawn and the undo history.
 */
export const inkSignature = (notes: BookNote[] | undefined) =>
  (notes ?? [])
    .filter((n) => n.type === 'ink')
    // Sync moves the notes it returns to the end of the list.
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((n) => `${n.id}|${n.deletedAt ?? 0}|${inkJsonOf(n.ink)}`)
    .join('\n');
