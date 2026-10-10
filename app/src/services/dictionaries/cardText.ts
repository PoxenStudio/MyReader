/** Visible text of a rendered dictionary card or group, descending into shadow roots. */
const SKIP_TEXT_TAGS = new Set(['STYLE', 'SCRIPT', 'LINK', 'BUTTON', 'AUDIO', 'VIDEO']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BR', 'TR', 'SUMMARY', 'H1', 'H2', 'H3', 'H4']);
const MAX_NOTE_CHARS = 2000;

// Visible text of a rendered card, descending into provider shadow roots.
const collectCardText = (node: Node, out: string[]): void => {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? '');
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const el = node as Element;
  if (el.tagName && SKIP_TEXT_TAGS.has(el.tagName)) return;
  if (el.shadowRoot) collectCardText(el.shadowRoot, out);
  node.childNodes.forEach((child) => collectCardText(child, out));
  if (el.tagName && BLOCK_TAGS.has(el.tagName)) out.push('\n');
};

export const extractCardText = (el: HTMLElement): string => {
  const parts: string[] = [];
  collectCardText(el, parts);
  const text = parts
    .join('')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}…` : text;
};
