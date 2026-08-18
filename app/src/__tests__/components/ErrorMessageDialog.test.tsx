import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

import ErrorMessageDialog from '@/components/ErrorMessageDialog';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// The wrapped <Alert> calls useKeyDownActions, which reads these.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));

afterEach(() => cleanup());

describe('ErrorMessageDialog', () => {
  it('shows the server-provided message and a single OK button, no Cancel', () => {
    const onClose = vi.fn();
    render(
      <ErrorMessageDialog message='Storage quota exceeded for this account.' onClose={onClose} />,
    );

    expect(screen.getByText('Storage quota exceeded for this account.')).not.toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();

    fireEvent.click(screen.getByText('OK').closest('button')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults the title to "Error" when none is given', () => {
    render(<ErrorMessageDialog message='Something failed.' onClose={vi.fn()} />);
    expect(screen.getByText('Error')).not.toBeNull();
  });

  it('uses a custom title when provided', () => {
    render(
      <ErrorMessageDialog
        title='Upload Failed: My Book'
        message='Something failed.'
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Upload Failed: My Book')).not.toBeNull();
  });
});
