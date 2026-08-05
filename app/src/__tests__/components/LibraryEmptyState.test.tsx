import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import LibraryEmptyState from '@/app/library/components/LibraryEmptyState';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({}),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/utils/nav', () => ({
  navigateToLogin: vi.fn(),
}));

afterEach(cleanup);

describe('LibraryEmptyState', () => {
  it('invokes onImportBooksFromDirectory with no arguments when "From Directory" is clicked', () => {
    // Regression test: the button used to be wired as
    // `onClick={onImportBooksFromDirectory}`, which hands the click's
    // SyntheticEvent to the callback as its first argument. Consumers
    // (e.g. page.tsx's `handleImportBooksFromDirectory(dirPath?: string)`)
    // treat any truthy first argument as an already-known directory path
    // and skip opening the folder picker, so the button silently did
    // nothing. The click handler must call through with zero arguments.
    const onImportBooksFromDirectory = vi.fn();
    const { getByText } = render(
      <LibraryEmptyState
        onImport={vi.fn()}
        onImportBooksFromDirectory={onImportBooksFromDirectory}
      />,
    );

    fireEvent.click(getByText('From Directory'));

    expect(onImportBooksFromDirectory).toHaveBeenCalledTimes(1);
    expect(onImportBooksFromDirectory.mock.calls[0]).toHaveLength(0);
  });
});
