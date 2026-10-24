/**
 * ReaderAccessGuard — the embedded reader's authorization gate.
 *
 * `/reader/[ids]` is served straight by MyReader (nginx routes the prefix to the
 * MyReader upstream), so MyBooks' REQUIRE_LOGIN gate never runs for it.
 * `readerx/open.tsx` already checks whoami before importing a book, but the
 * reader page itself must too — otherwise a book that reached the local library
 * (e.g. via a share link) could be reopened by URL with REQUIRE_LOGIN on and
 * ALLOW_GUEST_READ off. The gate must mirror MyBooks' decision, so it keys off
 * the same `GET /api/user/whoami` payload the share flow relies on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const mockEnvironment = vi.hoisted(() => ({ web: true, localDbDisabled: true }));

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: () => mockEnvironment.web,
  isLocalDbDisabled: () => mockEnvironment.localDbDisabled,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/reader/cloud-8674-epub' }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import { ReaderAccessGuard, isWhoamiPermitted } from '@/app/reader/components/ReaderAccessGuard';

const jsonResponse = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: async () => body } as Response);

describe('isWhoamiPermitted', () => {
  it('allows a guest identity (share grant or ALLOW_GUEST_READ)', () => {
    expect(isWhoamiPermitted({ is_guest: true, canRead: true, isActive: true })).toBe(true);
  });

  it('allows a logged-in user with read permission and an active account', () => {
    expect(isWhoamiPermitted({ userId: 1, username: 'admin', canRead: true, isActive: true })).toBe(
      true,
    );
  });

  it('rejects a logged-in user without read permission', () => {
    expect(isWhoamiPermitted({ userId: 1, canRead: false, isActive: true })).toBe(false);
  });

  it('rejects an inactive account', () => {
    expect(isWhoamiPermitted({ userId: 1, canRead: true, isActive: false })).toBe(false);
  });

  it('rejects the user.need_login payload', () => {
    expect(isWhoamiPermitted({ err: 'user.need_login', msg: '请先登录' })).toBe(false);
  });
});

describe('ReaderAccessGuard', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockEnvironment.web = true;
    mockEnvironment.localDbDisabled = true;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders children when whoami grants access', async () => {
    global.fetch = vi.fn(() => jsonResponse({ is_guest: true, canRead: true, isActive: true }));
    render(
      <ReaderAccessGuard>
        <div data-testid='reader'>reader</div>
      </ReaderAccessGuard>,
    );
    await waitFor(() => expect(screen.getByTestId('reader')).toBeTruthy());
  });

  it('hides the reader and offers MyBooks login when whoami denies access', async () => {
    global.fetch = vi.fn(() => jsonResponse({ err: 'user.need_login', msg: '请先登录' }));
    render(
      <ReaderAccessGuard>
        <div data-testid='reader'>reader</div>
      </ReaderAccessGuard>,
    );
    await waitFor(() => expect(screen.queryByTestId('reader')).toBeNull());
    const link = screen.getByRole('link', { name: 'Login' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      '/login/?next=' + encodeURIComponent('/reader/cloud-8674-epub'),
    );
  });

  it('hides the reader when whoami is unreachable', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    render(
      <ReaderAccessGuard>
        <div data-testid='reader'>reader</div>
      </ReaderAccessGuard>,
    );
    await waitFor(() => expect(screen.queryByTestId('reader')).toBeNull());
  });

  it('is a no-op outside the embedded deployment (Tauri / hosted web)', () => {
    mockEnvironment.localDbDisabled = false;
    global.fetch = vi.fn();
    render(
      <ReaderAccessGuard>
        <div data-testid='reader'>reader</div>
      </ReaderAccessGuard>,
    );
    expect(screen.getByTestId('reader')).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
