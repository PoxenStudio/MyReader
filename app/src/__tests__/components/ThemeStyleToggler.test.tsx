import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * Header-bar theme-style toggler (issue: quick theme switching).
 *
 * Sits to the left of the Font & Layout settings icon in the reader header.
 * Clicking it cycles through the three theme modes (auto -> light -> dark ->
 * auto) and its icon always reflects the mode that is currently active, so
 * the user can see and change the effective style with one click.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const setThemeMode = vi.fn();
let mockThemeMode: 'auto' | 'light' | 'dark' = 'auto';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeMode: mockThemeMode,
    setThemeMode,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

import ThemeStyleToggler from '@/app/reader/components/ThemeStyleToggler';

afterEach(() => {
  cleanup();
  setThemeMode.mockClear();
  mockThemeMode = 'auto';
});

describe('ThemeStyleToggler', () => {
  it('renders a single button', () => {
    render(<ThemeStyleToggler />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('switches from auto to light on click', () => {
    mockThemeMode = 'auto';
    render(<ThemeStyleToggler />);
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeMode).toHaveBeenCalledWith('light');
  });

  it('switches from light to dark on click', () => {
    mockThemeMode = 'light';
    render(<ThemeStyleToggler />);
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeMode).toHaveBeenCalledWith('dark');
  });

  it('wraps from dark back to auto on click', () => {
    mockThemeMode = 'dark';
    render(<ThemeStyleToggler />);
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeMode).toHaveBeenCalledWith('auto');
  });

  it('shows the currently active mode in its title', () => {
    mockThemeMode = 'dark';
    render(<ThemeStyleToggler />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('Dark Mode');
  });
});
