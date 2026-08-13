import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import SearchBar from '@/app/reader/components/notebook/SearchBar';

/**
 * On Android, returning from the reader to the bookshelf briefly flashes the
 * system keyboard. Root cause: this search bar unconditionally calls
 * `inputRef.current.focus()` whenever it becomes visible, unlike its sibling
 * `sidebar/SearchBar.tsx`, which guards the same call with
 * `!appService?.isMobile`. If the notebook search bar was ever shown, the
 * focused input un-mounting while the reader closes races with the WebView's
 * keyboard show/hide animation, producing the flash.
 */

let isMobile = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile } }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => ({ booknotes: [] }) }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

afterEach(() => {
  cleanup();
  isMobile = false;
});

describe('notebook SearchBar mobile focus (#keyboard-flash)', () => {
  it('does not steal focus on mobile when it becomes visible', () => {
    isMobile = true;

    const { getByPlaceholderText } = render(
      <SearchBar isVisible={true} bookKey='book-1' searchTerm='' onSearchResultChange={vi.fn()} />,
    );

    const input = getByPlaceholderText('Search notes and excerpts...');
    expect(document.activeElement).not.toBe(input);
  });

  it('still focuses the input on desktop when it becomes visible', () => {
    isMobile = false;

    const { getByPlaceholderText } = render(
      <SearchBar isVisible={true} bookKey='book-1' searchTerm='' onSearchResultChange={vi.fn()} />,
    );

    const input = getByPlaceholderText('Search notes and excerpts...');
    expect(document.activeElement).toBe(input);
  });
});
