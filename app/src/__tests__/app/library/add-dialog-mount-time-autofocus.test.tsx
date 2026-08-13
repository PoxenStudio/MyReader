import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import AddFeedModal from '@/app/library/components/feeds/AddFeedModal';
import ImportFromUrlDialog from '@/app/library/components/ImportFromUrlDialog';

/**
 * On Android, returning from the reader to the bookshelf briefly flashes the
 * system keyboard (confirmed via on-device focusin/focusout tracing).
 *
 * Root cause: `library/page.tsx` mounts <AddFeedModal> and
 * <ImportFromUrlDialog> unconditionally (only `isOpen` toggles their
 * *visual* Dialog state — the components themselves, and their `<input
 * autoFocus>`, stay in the React tree the whole time). Every time
 * LibraryPage remounts fresh (e.g. navigating back from the reader), React
 * commits both inputs for the first time and fires their `autoFocus`
 * regardless of `isOpen`, popping the keyboard for a form the user never
 * opened. `Dialog`'s own `previousActiveElementRef` restore then blurs it
 * ~200ms later (see Dialog.tsx), producing the flash.
 *
 * `<input autoFocus>` only ever fires once, on that first mount — so this
 * bug is also why re-opening either dialog a second time in the same
 * session doesn't focus the input at all.
 */

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  // Real Dialog renders `children` into the DOM regardless of `isOpen`
  // (only its own `<dialog open={isOpen}>` visibility toggles) — mirror
  // that here so the test exercises the actual mount-time bug.
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/store/feedStore', () => ({
  useFeedStore: { getState: () => ({ addFeed: vi.fn() }) },
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

afterEach(() => {
  cleanup();
});

describe('library "always-mounted" dialogs do not steal focus before opening (#keyboard-flash)', () => {
  it('AddFeedModal: does not focus its URL input while closed, but does once opened', () => {
    const { getByPlaceholderText, rerender } = render(
      <AddFeedModal isOpen={false} onClose={vi.fn()} />,
    );
    const input = getByPlaceholderText('https://example.com/feed.xml');
    expect(document.activeElement).not.toBe(input);

    rerender(<AddFeedModal isOpen={true} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(input);
  });

  it('ImportFromUrlDialog: does not focus its URL input while closed, but does once opened', () => {
    const { getByPlaceholderText, rerender } = render(
      <ImportFromUrlDialog isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    const input = getByPlaceholderText('https://example.com/article');
    expect(document.activeElement).not.toBe(input);

    rerender(<ImportFromUrlDialog isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(input);
  });
});
