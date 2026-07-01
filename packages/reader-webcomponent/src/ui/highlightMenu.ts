import type { ReaderNote } from '@myreader/reader-core';

/**
 * Shows/hides `button` based on whether the current section document has a
 * non-collapsed text selection. Kept deliberately simple (no floating popup
 * positioned at the selection rect) — the button lives in the toolbar and
 * just toggles visibility; `onHighlight` reads the live selection itself.
 */
export function attachHighlightTrigger(
  doc: Document,
  button: HTMLButtonElement,
  onHighlight: () => void,
): () => void {
  const update = () => {
    const sel = doc.getSelection();
    button.hidden = !sel || sel.isCollapsed || sel.toString().length === 0;
  };
  doc.addEventListener('selectionchange', update);
  button.addEventListener('click', onHighlight);
  update();

  return () => {
    doc.removeEventListener('selectionchange', update);
    button.removeEventListener('click', onHighlight);
  };
}

/** Renders a flat list of highlights with delete buttons into `container`. */
export function renderHighlightList(
  container: HTMLElement,
  notes: ReaderNote[],
  onDelete: (id: string) => void,
): () => void {
  const ul = document.createElement('ul');
  for (const note of notes) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = note.text ?? note.cfi;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.dataset['id'] = note.id;
    li.append(span, del);
    ul.append(li);
  }
  container.replaceChildren(ul);

  const onClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('button[data-id]') as HTMLButtonElement | null;
    if (!btn) return;
    onDelete(btn.dataset['id']!);
  };
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
    container.replaceChildren();
  };
}
