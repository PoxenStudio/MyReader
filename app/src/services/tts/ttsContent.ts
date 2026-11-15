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
