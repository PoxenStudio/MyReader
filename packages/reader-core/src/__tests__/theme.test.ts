import { describe, expect, it } from 'vitest';
import { getReaderStyles } from '../theme';

describe('getReaderStyles', () => {
  it('renders explicit light/dark palettes', () => {
    const light = getReaderStyles({ theme: 'light', pageLayout: 'paginated' });
    expect(light).toContain('#ffffff');

    const dark = getReaderStyles({ theme: 'dark', pageLayout: 'paginated' });
    expect(dark).toContain('#1a1a1a');
  });

  it('applies fontSize/lineHeight overrides', () => {
    const css = getReaderStyles({
      theme: 'light',
      pageLayout: 'paginated',
      fontSize: 20,
      lineHeight: 2,
    });
    expect(css).toContain('20px');
    expect(css).toContain('line-height: 2;');
  });
});
