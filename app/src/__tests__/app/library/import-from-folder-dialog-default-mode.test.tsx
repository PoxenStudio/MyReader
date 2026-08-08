import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportFromFolderDialog from '@/app/library/components/ImportFromFolderDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div role='dialog'>{children}</div>,
}));

afterEach(() => {
  cleanup();
});

describe('ImportFromFolderDialog default folder-structure mode', () => {
  // When the caller doesn't pass `initialFolderMode` (e.g. first-time use,
  // nothing yet persisted in localStorage), the dialog should default to
  // "Import all into library" (flatten) rather than "Create groups from
  // subfolders" (keep).
  it('selects "Import all into library" by default when initialFolderMode is omitted', () => {
    render(
      <ImportFromFolderDialog
        initialDirectory='/some/folder'
        onPickDirectory={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const keepRadio = screen.getByRole('radio', { name: /Create groups from subfolders/ });
    const flattenRadio = screen.getByRole('radio', { name: /Import all into library/ });

    expect((keepRadio as HTMLInputElement).checked).toBe(false);
    expect((flattenRadio as HTMLInputElement).checked).toBe(true);
  });
});
