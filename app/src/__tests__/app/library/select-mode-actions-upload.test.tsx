import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false } }),
}));

import SelectModeActions from '@/app/library/components/SelectModeActions';

afterEach(() => {
  cleanup();
});

const baseProps = {
  selectedBooks: ['a'.repeat(32)],
  safeAreaBottom: 0,
  onOpen: vi.fn(),
  onGroup: vi.fn(),
  onDetails: vi.fn(),
  onStatus: vi.fn(),
  onSend: vi.fn(),
  onDelete: vi.fn(),
  onCancel: vi.fn(),
};

describe('SelectModeActions upload button', () => {
  it('renders Upload right after Send (which follows Details)', () => {
    render(<SelectModeActions {...baseProps} onUpload={vi.fn()} canUpload={true} />);

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text): text is string => !!text);

    expect(labels.indexOf('Send')).toBe(labels.indexOf('Details') + 1);
    expect(labels.indexOf('Upload')).toBe(labels.indexOf('Send') + 1);
  });

  it('disables Upload when the selection has no uploadable book (mirrors uploadBookMenuItem availability)', () => {
    render(<SelectModeActions {...baseProps} onUpload={vi.fn()} canUpload={false} />);

    const uploadButton = screen.getByText('Upload').closest('button')!;
    expect(uploadButton.className).toContain('btn-disabled');
  });

  it('invokes onUpload when clicked while uploadable', () => {
    const onUpload = vi.fn();
    render(<SelectModeActions {...baseProps} onUpload={onUpload} canUpload={true} />);

    fireEvent.click(screen.getByText('Upload').closest('button')!);

    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});
