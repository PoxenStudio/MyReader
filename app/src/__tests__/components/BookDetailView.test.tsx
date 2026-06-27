import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { Book } from '@/types/book';
import BookDetailView from '@/components/metadata/BookDetailView';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: true,
      metadataDescriptionCollapsed: true,
    },
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock
    return <img {...props} />;
  },
}));

afterEach(() => cleanup());

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'EPUB',
    coverImageUrl: 'https://example.com/cover.jpg',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    downloadedAt: Date.now(),
    uploadedAt: Date.now(),
    ...overrides,
  }) as Book;

const renderView = (extra?: Partial<React.ComponentProps<typeof BookDetailView>>) =>
  render(
    <DropdownProvider>
      <BookDetailView
        book={makeBook()}
        metadata={null}
        fileSize={1024}
        onDelete={vi.fn()}
        {...extra}
      />
    </DropdownProvider>,
  );

describe('BookDetailView delete control', () => {
  it('renders a single delete button that calls onDelete when clicked', () => {
    const onDelete = vi.fn();
    const { container } = renderView({ onDelete });
    const button = container.querySelector('button[title="Delete Book"]');
    expect(button).toBeTruthy();

    fireEvent.click(button!);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables the delete button and ignores clicks when deleteDisabled is true', () => {
    const onDelete = vi.fn();
    const { container } = renderView({ onDelete, deleteDisabled: true });
    const button = container.querySelector('button[title="Delete Book"]');
    expect(button).toBeTruthy();
    expect(button!.className).toContain('btn-disabled');

    fireEvent.click(button!);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('does not render a delete button when onDelete is not provided', () => {
    const { container } = renderView({ onDelete: undefined });
    const button = container.querySelector('button[title="Delete Book"]');
    expect(button).toBeFalsy();
  });
});
