import type { TOCItem } from '@myreader/reader-core';

const buildList = (items: TOCItem[]): HTMLUListElement => {
  const ul = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.label;
    a.dataset['href'] = item.href;
    li.append(a);
    if (item.subitems?.length) li.append(buildList(item.subitems));
    ul.append(li);
  }
  return ul;
};

/** Renders a nested TOC list into `container`; returns a cleanup function. */
export function renderTOC(
  container: HTMLElement,
  toc: TOCItem[],
  onSelect: (href: string) => void,
): () => void {
  container.replaceChildren(buildList(toc));

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-href]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    onSelect(a.dataset['href']!);
  };
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('click', onClick);
    container.replaceChildren();
  };
}
