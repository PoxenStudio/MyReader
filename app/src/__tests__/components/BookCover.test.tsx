import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';

import BookCover from '@/components/BookCover';
import { Book } from '@/types/book';
import { __resetCoverObjectUrlCacheForTests } from '@/utils/coverObjectUrlCache';
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
}));
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

const getNasCookiesMock = vi.fn();
vi.mock('@/services/mybooks/nasCookieStore', () => ({
  NAS_CHROME_USER_AGENT: 'test-nas-chrome-ua',
  getNasCookies: (...args: unknown[]) => getNasCookiesMock(...args),
}));

const settingsStoreState = { settings: { nas: { enabled: false } } };
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => settingsStoreState },
}));

afterEach(cleanup);

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'epub',
    coverImageUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }) as Book;

describe('BookCover', () => {
  it('passes loading="lazy" to crop-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('passes loading="lazy" to fit-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='fit' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('reports natural aspect ratio via onAspectRatioChange when fit-mode image loads', () => {
    const onAspectRatioChange = vi.fn();
    const { container } = render(
      <BookCover book={makeBook()} coverFit='fit' onAspectRatioChange={onAspectRatioChange} />,
    );
    const img = container.querySelector('img.cover-image') as HTMLImageElement;
    expect(img).toBeTruthy();

    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    fireEvent.load(img);

    expect(onAspectRatioChange).toHaveBeenCalledWith(600 / 900);
  });

  it('falls back to metadata.author on the fallback cover when book.author is empty', () => {
    const book = makeBook({
      author: '',
      coverImageUrl: undefined,
      metadata: { author: 'Edited Author' } as Book['metadata'],
    });
    const { container } = render(<BookCover book={book} coverFit='crop' />);
    const fallback = container.querySelector('.fallback-cover');
    expect(fallback?.textContent).toContain('Edited Author');
  });
});

// Regression coverage for the Android bookshelf scroll flicker: Virtuoso
// unmounts/remounts BookCover as items cross its overscan window during a
// fling, so a remote cover must not re-fetch and re-decode on every remount.
describe('BookCover remote covers on Tauri', () => {
  const remoteUrl = 'https://nas.example.com/covers/1.jpg';
  const objectUrl = `blob:${remoteUrl}`;

  beforeEach(() => {
    __resetCoverObjectUrlCacheForTests();
    vi.clearAllMocks();
    getNasCookiesMock.mockReturnValue(null);
    settingsStoreState.settings.nas = { enabled: false };
    (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
      }),
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    (tauriFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      blob: vi.fn().mockResolvedValue(new Blob()),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('shows the fetched cover once the async fetch resolves', async () => {
    const book = makeBook({ coverImageUrl: remoteUrl, hash: 'remote-1' });
    const { container } = render(<BookCover book={book} coverFit='crop' />);

    await waitFor(() => {
      expect(container.querySelector('img.cover-image')?.getAttribute('src')).toBe(objectUrl);
    });
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    // NAS login disabled (the default here) — no Cookie/User-Agent added.
    expect(tauriFetch).toHaveBeenCalledWith(
      remoteUrl,
      expect.objectContaining({ headers: { Accept: 'image/*' } }),
    );
    expect(getNasCookiesMock).not.toHaveBeenCalled();
  });

  it('attaches the NAS cookie and User-Agent when NAS login is enabled', async () => {
    getNasCookiesMock.mockReturnValue('nas-token=xyz');
    settingsStoreState.settings.nas = { enabled: true };
    const book = makeBook({ coverImageUrl: remoteUrl, hash: 'remote-nas' });
    const { container } = render(<BookCover book={book} coverFit='crop' />);

    await waitFor(() => {
      expect(container.querySelector('img.cover-image')?.getAttribute('src')).toBe(objectUrl);
    });
    expect(tauriFetch).toHaveBeenCalledWith(
      remoteUrl,
      expect.objectContaining({
        headers: {
          Accept: 'image/*',
          Cookie: 'nas-token=xyz',
          'User-Agent': 'test-nas-chrome-ua',
        },
      }),
    );
  });

  it('still adds the NAS User-Agent when NAS login is enabled but no NAS cookie was captured yet', async () => {
    getNasCookiesMock.mockReturnValue(null);
    settingsStoreState.settings.nas = { enabled: true };
    const book = makeBook({ coverImageUrl: remoteUrl, hash: 'remote-nas-no-cookie' });
    const { container } = render(<BookCover book={book} coverFit='crop' />);

    await waitFor(() => {
      expect(container.querySelector('img.cover-image')?.getAttribute('src')).toBe(objectUrl);
    });
    expect(tauriFetch).toHaveBeenCalledWith(
      remoteUrl,
      expect.objectContaining({
        headers: { Accept: 'image/*', 'User-Agent': 'test-nas-chrome-ua' },
      }),
    );
  });

  it('reuses the cached object URL on remount instead of re-fetching', async () => {
    const book = makeBook({ coverImageUrl: remoteUrl, hash: 'remote-1' });
    const first = render(<BookCover book={book} coverFit='crop' />);
    await waitFor(() => {
      expect(first.container.querySelector('img.cover-image')?.getAttribute('src')).toBe(objectUrl);
    });
    first.unmount();

    // Simulates Virtuoso remounting the same item after a fling crosses its
    // overscan window: the real cover must be present on the very first
    // render, with no fetch and no blank/fallback frame in between.
    const second = render(<BookCover book={book} coverFit='crop' />);
    expect(second.container.querySelector('img.cover-image')?.getAttribute('src')).toBe(objectUrl);
    expect(second.container.querySelector('.fallback-cover')?.classList).toContain('invisible');
    expect(tauriFetch).toHaveBeenCalledTimes(1);
  });
});
