export interface TTSContent {
  doc: Document;
  index?: number;
  overlayer?: unknown;
}

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
// the spoken range (the rest of the section sits in later columns). The range
// rect is relative to the iframe viewport, so compare it with the frame size.
export const isRangeVisibleInContent = (content: TTSContent, range: Range): boolean => {
  const frame = content.doc.defaultView?.frameElement as HTMLElement | null;
  if (!frame) return true;
  const frameRect = frame.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return false;
  return Array.from(range.getClientRects()).some(
    (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < frameRect.width &&
      rect.bottom > 0 &&
      rect.top < frameRect.height,
  );
};
