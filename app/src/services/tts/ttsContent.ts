import { compare as compareCFI } from 'foliate-js/epubcfi.js';

export interface TTSContent {
  doc: Document;
  index?: number;
  overlayer?: unknown;
}

export interface TtsNavigationTarget {
  index?: number;
  cfi?: string;
  /* A scrubber preview navigates the view without moving the session, so the
     relocate it produces must not be committed as reading progress. */
  preview?: boolean;
}

// view.js's relocate detail spreads the section progress (whose `current` is
// the spine index) and drops the renderer's top-level `index`, so consumers
// must read the target section from `section.current`.
export const relocateTargetOf = (
  detail: { cfi?: string; index?: number; section?: { current?: number } } | null | undefined,
): TtsNavigationTarget => ({
  index: detail?.index ?? detail?.section?.current,
  cfi: detail?.cfi,
});

// foliate-js marks the hidden stand-ins of a chunked section; a chunk document
// is only part of the section and must not be used as the TTS text basis.
export const isChunkDocument = (doc: Document): boolean =>
  !!doc.querySelector('[data-foliate-chunk]');

const ttsNavigationGuards = new Map<string, TtsNavigationTarget & { at: number }>();

// The paginated renderer settles every programmatic page flip with a debounced
// 'container-scroll' relocate 250 ms later. When the flip came from a scrubber
// preview, that settle reports the previewed page and must not be committed as
// reading progress. The window is generous (the debounce is 250 ms); a settle
// is a duplicate of a relocate already committed, so swallowing one that
// arrives shortly after a preview costs nothing.
const PREVIEW_SETTLE_WINDOW_MS = 2000;

export const isPreviewSettle = (
  pending: { at: number } | null,
  reason: string | undefined,
  now: number = Date.now(),
): boolean => {
  if (!pending || reason !== 'container-scroll') return false;
  return now - pending.at < PREVIEW_SETTLE_WINDOW_MS;
};

export const markTtsNavigation = (bookKey: string, target: TtsNavigationTarget = {}): void => {
  ttsNavigationGuards.set(bookKey, { ...target, at: Date.now() });
};

// TTS-driven goTo/section-change relocates must not write page-start CFIs into
// progress. Match the requested target so a user page turn inside the same
// time window still commits; expire the guard so a no-op navigation cannot
// swallow a later user relocate indefinitely. Returns the consumed target (so
// callers can honor its `preview` flag), or null when the relocate is not ours.
export const consumeTtsNavigation = (
  bookKey: string,
  relocated: { index?: number; cfi?: string } = {},
): TtsNavigationTarget | null => {
  const guard = ttsNavigationGuards.get(bookKey);
  if (!guard) return null;
  if (Date.now() - guard.at >= 5000) {
    ttsNavigationGuards.delete(bookKey);
    return null;
  }
  if (guard.index != null && relocated.index != null && guard.index !== relocated.index) {
    return null;
  }
  if (guard.cfi && relocated.cfi) {
    try {
      // The page that contains the target starts at or before it.
      if (compareCFI(relocated.cfi, guard.cfi) > 0) return null;
    } catch {
      // Unparseable CFI: fall back to the time window.
    }
  }
  ttsNavigationGuards.delete(bookKey);
  // Copy, so the internal timestamp does not leak into the public result.
  return { index: guard.index, cfi: guard.cfi, preview: guard.preview };
};

export const findContentByIndex = (
  contents: readonly TTSContent[],
  index: number,
): TTSContent | undefined => contents.find((content) => content.index === index);

export const isContentVisible = (renderer: Element, content: TTSContent): boolean => {
  const frame = content.doc.defaultView?.frameElement as HTMLElement | null;
  // Non-iframe renderers / test DOMs have no frame host; only the primary
  // content can be assumed visible there.
  if (!frame) {
    return content.index === (renderer as unknown as { primaryIndex?: number }).primaryIndex;
  }
  const frameRect = frame.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return false;
  const hostRect = renderer.getBoundingClientRect();
  return (
    frameRect.right > hostRect.left &&
    frameRect.left < hostRect.right &&
    frameRect.bottom > hostRect.top &&
    frameRect.top < hostRect.bottom
  );
};

// A visible iframe can still be showing a page/column that does not contain
// the spoken range. The paginator expands each iframe to the section's full
// multi-page size, so map the range's iframe-local rects into host coordinates
// and intersect with the reader viewport (not the iframe's own width).
export const isRangeVisibleInContent = (
  renderer: Element,
  content: TTSContent,
  range: Range,
): boolean => {
  const frame = content.doc.defaultView?.frameElement as HTMLElement | null;
  if (!frame) return true;
  const frameRect = frame.getBoundingClientRect();
  const hostRect = renderer.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return false;
  const scaleX = frame.clientWidth ? frameRect.width / frame.clientWidth : 1;
  const scaleY = frame.clientHeight ? frameRect.height / frame.clientHeight : 1;
  return Array.from(range.getClientRects()).some((rect) => {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const left = frameRect.left + rect.left * scaleX;
    const right = frameRect.left + rect.right * scaleX;
    const top = frameRect.top + rect.top * scaleY;
    const bottom = frameRect.top + rect.bottom * scaleY;
    return (
      right > hostRect.left &&
      left < hostRect.right &&
      bottom > hostRect.top &&
      top < hostRect.bottom
    );
  });
};
