import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const { mergeTauriMyBooksCookie } = vi.hoisted(() => ({ mergeTauriMyBooksCookie: vi.fn() }));
vi.mock('@/services/mybooks/tauriCookieStore', () => ({
  mergeTauriMyBooksCookie,
  extractCookieHeaderFromResponse: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import {
  setStoredMyBooksAccessCode,
  getStoredMyBooksAccessCode,
  clearStoredMyBooksAccessCode,
} from '@/utils/credentialStorage';
import { AccessCodeDialog } from '@/components/user/AccessCodeDialog';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('AccessCodeDialog remember-code option', () => {
  it('prefills and checks "remember" when a code was previously saved', () => {
    setStoredMyBooksAccessCode('saved-code');

    const { getByPlaceholderText, getByRole } = render(
      <AccessCodeDialog host='https://mybooks.example.com' onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect((getByPlaceholderText('Enter your access code') as HTMLInputElement).value).toBe(
      'saved-code',
    );
    expect((getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('saves the code obfuscated on success when "remember" is checked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: new Headers(),
    } as Response);
    const onSuccess = vi.fn();

    const { getByPlaceholderText, getByRole, getByText } = render(
      <AccessCodeDialog
        host='https://mybooks.example.com'
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(getByPlaceholderText('Enter your access code'), {
      target: { value: 'my-code' },
    });
    fireEvent.click(getByRole('checkbox'));
    fireEvent.click(getByText('Sign In'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getStoredMyBooksAccessCode()).toBe('my-code');
    expect(localStorage.getItem('mybooks_access_code')).not.toBe('my-code');
  });

  it('clears any saved code on success when "remember" is left unchecked', async () => {
    setStoredMyBooksAccessCode('old-code');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: new Headers(),
    } as Response);
    const onSuccess = vi.fn();

    const { getByRole, getByText } = render(
      <AccessCodeDialog
        host='https://mybooks.example.com'
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    // Uncheck the box the prefill turned on, then submit the prefilled code.
    fireEvent.click(getByRole('checkbox'));
    fireEvent.click(getByText('Sign In'));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getStoredMyBooksAccessCode()).toBeNull();
  });

  it('does not merge a Tauri cookie on the web platform', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ err: 'ok' }),
      headers: new Headers(),
    } as Response);

    const { getByPlaceholderText, getByText } = render(
      <AccessCodeDialog host='https://mybooks.example.com' onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.change(getByPlaceholderText('Enter your access code'), {
      target: { value: 'my-code' },
    });
    fireEvent.click(getByText('Sign In'));

    await waitFor(() => expect(mergeTauriMyBooksCookie).not.toHaveBeenCalled());
  });
});

describe('cleanup helper sanity', () => {
  it('clearStoredMyBooksAccessCode removes the stored value', () => {
    setStoredMyBooksAccessCode('x');
    clearStoredMyBooksAccessCode();
    expect(getStoredMyBooksAccessCode()).toBeNull();
  });
});
