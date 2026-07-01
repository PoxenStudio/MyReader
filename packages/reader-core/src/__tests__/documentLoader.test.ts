import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader } from '../documentLoader';

if (typeof globalThis['CSS'] === 'undefined') {
  (globalThis as Record<string, unknown>)['CSS'] = {
    escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
  };
}

if (!customElements.get('foliate-paginator')) {
  customElements.define(
    'foliate-paginator',
    class extends HTMLElement {
      override setAttribute() {}
      override addEventListener() {}
      open() {}
    },
  );
}

vi.mock('foliate-js/paginator.js', () => ({}));

describe('DocumentLoader.open', () => {
  it('opens a sample EPUB and returns its sections', async () => {
    const bytes = readFileSync(resolve(__dirname, 'fixtures/sample-alice.epub'));
    const file = new File([bytes], 'sample-alice.epub', { type: 'application/epub+zip' });

    const { book, format } = await new DocumentLoader(file).open();

    expect(format).toBe('EPUB');
    expect(book.sections.length).toBeGreaterThan(0);
  }, 15000);
});
