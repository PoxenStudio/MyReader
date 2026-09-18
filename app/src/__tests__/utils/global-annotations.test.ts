import { describe, it, expect, vi } from 'vitest';
import {
  expandGlobalAnnotation,
  removeGlobalAnnotationOverlays,
} from '@/app/reader/utils/globalAnnotations';
import { BookNote } from '@/types/book';
import { FoliateView, NOTE_PREFIX } from '@/types/view';

/**
 * Regression coverage for issue #4575: highlighting recurring character names
 * (global annotations) made page turning very laggy. The `progress` effect
 * re-fans-out every global annotation across every rendered section on EVERY
 * page turn. Because the overlays are already drawn, re-walking the DOM and
 * re-computing `view.getCFI()` for every occurrence is pure wasted work — the
 * dominant per-page-turn cost on books with frequent highlighted words.
 *
 * `expandGlobalAnnotation` must therefore be idempotent: expanding the same
 * note into the same (already-expanded) section a second time must do no work.
 */

const note = (overrides: Partial<BookNote>): BookNote => ({
  id: 'note-1',
  type: 'annotation',
  cfi: 'home-cfi',
  note: '',
  text: 'foo',
  style: 'highlight',
  color: 'yellow',
  global: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

/** A jsdom section document where `text` recurs `count` times. */
const makeDoc = (needle: string, count: number): Document => {
  const doc = document.implementation.createHTMLDocument('section');
  const body = Array.from({ length: count }, () => `${needle} `).join('gap ');
  doc.body.innerHTML = `<p>${body}</p>`;
  return doc;
};

type FakeView = FoliateView & { getCfiCalls: number };

/**
 * Minimal stand-in for the foliate view. `getCFI` returns a unique value per
 * call (so it never collides with the note's home anchor) and counts how many
 * times it ran — our proxy for the expensive per-occurrence work a page turn
 * would repeat.
 */
const makeView = (docs: Document[]): FakeView => {
  const overlayer = { add: vi.fn(), remove: vi.fn() };
  const view = {
    getCfiCalls: 0,
    renderer: {
      getContents: () => docs.map((doc, index) => ({ index, doc, overlayer })),
    },
    getCFI(_index: number, _range: Range) {
      this.getCfiCalls += 1;
      return `cfi-${this.getCfiCalls}`;
    },
    dispatchEvent: () => true,
  };
  return view as unknown as FakeView;
};

describe('expandGlobalAnnotation idempotency (issue #4575)', () => {
  it('expands every occurrence on first call for a section', () => {
    const doc = makeDoc('foo', 3);
    const view = makeView([doc]);
    const added = expandGlobalAnnotation(view, note({}), doc, 0);
    expect(added).toHaveLength(3);
    expect(view.getCfiCalls).toBe(3);
  });

  it('does NO work when re-expanding the same note into the same section', () => {
    const doc = makeDoc('foo', 3);
    const view = makeView([doc]);
    const n = note({ id: 'same-note' });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(3);

    // Second pass simulates the next page turn — overlays already exist.
    const added2 = expandGlobalAnnotation(view, n, doc, 0);
    expect(added2).toEqual([]);
    expect(view.getCfiCalls).toBe(3); // unchanged: no re-walk, no re-getCFI
  });

  it('re-expands when the note content changes (edit/recolor bumps updatedAt)', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'edited-note', updatedAt: 10 });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(2);
    const added = expandGlobalAnnotation(view, { ...n, updatedAt: 11 }, doc, 0);
    expect(added).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4);
  });

  it('re-expands after overlays are removed (toggle global off then on)', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'retoggle-note' });
    expandGlobalAnnotation(view, n, doc, 0);
    expect(view.getCfiCalls).toBe(2);

    // Toggle off: overlays torn down and the memo cleared.
    removeGlobalAnnotationOverlays(view, n);

    // Toggle back on with identical content — must re-fan-out, not short-circuit.
    const added = expandGlobalAnnotation(view, n, doc, 0);
    expect(added).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4);
  });

  it('re-expands into a freshly rendered section (different doc)', () => {
    const docA = makeDoc('foo', 2);
    const docB = makeDoc('foo', 2);
    const view = makeView([docA, docB]);
    const n = note({ id: 'multi-section' });
    expandGlobalAnnotation(view, n, docA, 0);
    const addedB = expandGlobalAnnotation(view, n, docB, 1);
    expect(addedB).toHaveLength(2);
    expect(view.getCfiCalls).toBe(4); // 2 per distinct section
  });
});

/**
 * A global note that carries note text (not just a highlight style) must also
 * fan out its note-bubble icon to every occurrence — not just the original
 * anchor. Previously `expandGlobalAnnotation` only ever emitted one overlay
 * per occurrence, keyed without the `NOTE_PREFIX` marker, so
 * `decideAnnotationDraw` always resolved it to a highlight/underline and the
 * bubble (and its click-to-view-note popup) never appeared anywhere but the
 * spot the note was originally created on.
 */
describe('expandGlobalAnnotation note-bubble fan-out', () => {
  it('emits both a highlight overlay and a NOTE_PREFIX bubble overlay per occurrence when note text is set', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'noted', note: 'this is a person name' });
    const added = expandGlobalAnnotation(view, n, doc, 0);

    expect(added).toHaveLength(4); // 2 occurrences x (highlight + bubble)
    const bubbleValues = added.filter((v) => v.startsWith(NOTE_PREFIX));
    const plainValues = added.filter((v) => !v.startsWith(NOTE_PREFIX));
    expect(bubbleValues).toHaveLength(2);
    expect(plainValues).toHaveLength(2);
    // The bubble value must map back to the same occurrence's plain value so
    // a click on it can resolve the same source CFI.
    bubbleValues.forEach((bubble) => {
      expect(plainValues).toContain(bubble.replace(NOTE_PREFIX, ''));
    });
  });

  it('emits only the plain overlay per occurrence when the note has no text (pure highlight)', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const n = note({ id: 'unnoted', note: '' });
    const added = expandGlobalAnnotation(view, n, doc, 0);

    expect(added).toHaveLength(2);
    expect(added.some((v) => v.startsWith(NOTE_PREFIX))).toBe(false);
  });

  it('removes both the plain and NOTE_PREFIX bubble overlays on teardown', () => {
    const doc = makeDoc('foo', 2);
    const view = makeView([doc]);
    const overlayer = (
      view.renderer!.getContents!()[0] as unknown as {
        overlayer: { remove: ReturnType<typeof vi.fn> };
      }
    ).overlayer;
    const n = note({ id: 'noted-removed', note: 'a place name' });
    expandGlobalAnnotation(view, n, doc, 0);

    removeGlobalAnnotationOverlays(view, n);

    const removedKeys = overlayer.remove.mock.calls.map((call) => call[0] as string);
    expect(removedKeys.some((k) => k.startsWith(NOTE_PREFIX))).toBe(true);
    expect(removedKeys.some((k) => !k.startsWith(NOTE_PREFIX))).toBe(true);
  });
});
