import type { ReaderViewSettings } from '@myreader/reader-core';

/** Renders a minimal settings form into `container`; returns a cleanup function. */
export function renderSettings(
  container: HTMLElement,
  settings: ReaderViewSettings,
  onChange: (patch: Partial<ReaderViewSettings>) => void,
): () => void {
  container.innerHTML = `
    <form>
      <label>Theme
        <select name="theme">
          <option value="light">light</option>
          <option value="dark">dark</option>
          <option value="auto">auto</option>
        </select>
      </label>
      <label>Font family
        <input name="fontFamily" type="text" />
      </label>
      <label>Font size
        <input name="fontSize" type="number" min="8" max="48" />
      </label>
      <label>Line height
        <input name="lineHeight" type="number" min="1" max="3" step="0.1" />
      </label>
      <label>Page layout
        <select name="pageLayout">
          <option value="paginated">paginated</option>
          <option value="scrolled">scrolled</option>
        </select>
      </label>
    </form>
  `;

  const form = container.querySelector('form')!;
  const theme = form.elements.namedItem('theme') as HTMLSelectElement;
  const fontFamily = form.elements.namedItem('fontFamily') as HTMLInputElement;
  const fontSize = form.elements.namedItem('fontSize') as HTMLInputElement;
  const lineHeight = form.elements.namedItem('lineHeight') as HTMLInputElement;
  const pageLayout = form.elements.namedItem('pageLayout') as HTMLSelectElement;

  theme.value = settings.theme;
  fontFamily.value = settings.fontFamily ?? '';
  fontSize.value = String(settings.fontSize ?? 16);
  lineHeight.value = String(settings.lineHeight ?? 1.6);
  pageLayout.value = settings.pageLayout;

  const onInput = () => {
    onChange({
      theme: theme.value as ReaderViewSettings['theme'],
      fontFamily: fontFamily.value || undefined,
      fontSize: Number(fontSize.value) || undefined,
      lineHeight: Number(lineHeight.value) || undefined,
      pageLayout: pageLayout.value as ReaderViewSettings['pageLayout'],
    });
  };
  form.addEventListener('input', onInput);

  return () => {
    form.removeEventListener('input', onInput);
    container.replaceChildren();
  };
}
