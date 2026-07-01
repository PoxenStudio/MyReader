import type { ReaderViewSettings } from './sync';

const PALETTES = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1a1a1a', fg: '#e8e8e8' },
};

const resolveMode = (theme: ReaderViewSettings['theme']): 'light' | 'dark' => {
  if (theme === 'light' || theme === 'dark') return theme;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

/**
 * A trimmed CSS stylesheet (font/line-height/colors only, no palette
 * generation, custom fonts, or code highlighting — see app/src/utils/style.ts
 * for the full version this is deliberately not porting).
 */
export function getReaderStyles(settings: ReaderViewSettings): string {
  const { bg, fg } = PALETTES[resolveMode(settings.theme)];
  const fontFamily = settings.fontFamily || 'serif';
  const fontSize = settings.fontSize ?? 16;
  const lineHeight = settings.lineHeight ?? 1.6;

  return `
    html, body {
      background: ${bg};
      color: ${fg};
    }
    body {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      line-height: ${lineHeight};
    }
    a { color: inherit; }
  `;
}
