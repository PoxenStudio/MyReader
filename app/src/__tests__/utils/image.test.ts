import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock globals for jsdom canvas / Image / fetch ─────────────────────
// jsdom does not implement canvas or Image loading, so we mock them.

interface MockImageInstance {
  crossOrigin: string;
  src: string;
  width: number;
  height: number;
  onload: ((ev?: Event) => void) | null;
  onerror: ((ev?: string | Event) => void) | null;
}

let mockImageInstances: MockImageInstance[] = [];

class MockImage {
  crossOrigin = '';
  src = '';
  width = 200;
  height = 300;
  onload: ((ev?: Event) => void) | null = null;
  onerror: ((ev?: string | Event) => void) | null = null;

  constructor() {
    mockImageInstances.push(this as MockImageInstance);
    // Auto-trigger onload when src is set
    Object.defineProperty(this, 'src', {
      get: () => this._src,
      set: (val: string) => {
        this._src = val;
        if (val) {
          // Schedule onload in a microtask to allow tests to set handlers
          Promise.resolve().then(() => {
            if (this.onload) {
              this.onload(new Event('load'));
            }
          });
        }
      },
    });
  }
  private _src = '';
}

// Mock canvas context
interface MockCanvasContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  drawImage: ReturnType<typeof vi.fn>;
}

let mockCtx: MockCanvasContext;

const mockToDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,AABBCC');
const mockToBlob = vi.fn();

function createMockCanvas() {
  mockCtx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    drawImage: vi.fn(),
  };

  return {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toDataURL: mockToDataURL,
    toBlob: mockToBlob,
  };
}

// Patch document.createElement for canvas
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  if (tag === 'canvas') {
    return createMockCanvas() as unknown as HTMLElement;
  }
  return originalCreateElement(tag);
});

// Patch global Image
vi.stubGlobal('Image', MockImage);

// Patch URL.createObjectURL/revokeObjectURL (not provided by jsdom) while
// keeping `URL` a real constructor — fetchImageAsBase64 calls `new URL(...)`
// to classify remote vs. local image URLs, which a plain object stub breaks.
class MockURL extends URL {
  static createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/fake-blob');
  static revokeObjectURL = vi.fn();
}
vi.stubGlobal('URL', MockURL);

// Mock fetch
const mockFetchResponse = {
  ok: true,
  status: 200,
  statusText: 'OK',
  blob: vi.fn().mockResolvedValue(new Blob(['fake-image-data'], { type: 'image/jpeg' })),
};
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

// Tauri platform + HTTP plugin mocks — a plain `fetch` to a NAS/MyBooks host
// gets blocked by the WebView's CORS enforcement (no `Access-Control-Allow-
// Origin` on those image endpoints), so Tauri builds must route through
// `tauriFetch` (Tauri's native Rust HTTP client) instead, same as BookCover.
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
}));
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Import after mocks
import { isTauriAppPlatform } from '@/services/environment';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { fetchImageAsBase64 } from '@/utils/image';

beforeEach(() => {
  vi.clearAllMocks();
  mockImageInstances = [];
  mockFetchResponse.ok = true;
  mockFetchResponse.status = 200;
  mockFetchResponse.statusText = 'OK';
  mockFetchResponse.blob.mockResolvedValue(new Blob(['fake-image-data'], { type: 'image/jpeg' }));
  (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (tauriFetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockFetchResponse);
  // Re-apply document.createElement mock (restoreAllMocks clears it)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return createMockCanvas() as unknown as HTMLElement;
    }
    return originalCreateElement(tag);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchImageAsBase64', () => {
  test('fetches image and returns base64 string', async () => {
    const result = await fetchImageAsBase64('https://example.com/image.jpg');

    expect(fetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(result).toBe('data:image/jpeg;base64,AABBCC');
  });

  test('uses default options when none specified', async () => {
    await fetchImageAsBase64('https://example.com/image.jpg');

    // Default format is image/jpeg, quality 0.85, targetWidth 256
    expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
  });

  test('uses custom options', async () => {
    await fetchImageAsBase64('https://example.com/image.png', {
      targetWidth: 128,
      format: 'image/png',
      quality: 0.5,
    });

    expect(mockToDataURL).toHaveBeenCalledWith('image/png', 0.5);
  });

  test('rejects on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
      'Network error',
    );
  });

  test('rejects on non-ok response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchImageAsBase64('https://example.com/image.jpg')).rejects.toThrow(
      'Failed to fetch image: 404 Not Found',
    );
  });

  test('calculates correct dimensions from aspect ratio', async () => {
    // Image: 200x300, targetWidth 256 -> newHeight = 256 * (300/200) = 384
    await fetchImageAsBase64('https://example.com/image.jpg', { targetWidth: 256 });

    // The canvas size should be set appropriately
    // We verify drawImage was called with correct dimensions
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  test('creates object URL and revokes it', async () => {
    await fetchImageAsBase64('https://example.com/image.jpg');

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  test('uses global fetch on web (not the Tauri HTTP client)', async () => {
    (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await fetchImageAsBase64('http://192.168.31.102:8082/get/thumb_240_320/33622.jpg');

    expect(fetch).toHaveBeenCalledWith('http://192.168.31.102:8082/get/thumb_240_320/33622.jpg');
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  test('routes through tauriFetch on Tauri, bypassing WebView CORS enforcement', async () => {
    (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);
    // The plain global `fetch` would be rejected by the WebView with a CORS
    // error for a cross-origin NAS image endpoint (no Access-Control-Allow-
    // Origin header) — asserted below via `fetch` never being called at all.

    const result = await fetchImageAsBase64(
      'http://192.168.31.102:8082/get/thumb_240_320/33622.jpg',
    );

    expect(tauriFetch).toHaveBeenCalledWith(
      'http://192.168.31.102:8082/get/thumb_240_320/33622.jpg',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toBe('data:image/jpeg;base64,AABBCC');
  });

  // tauriFetch is Tauri's native Rust HTTP client (reqwest) — it has no
  // handler for the WebView-only asset-protocol virtual hosts below, so
  // routing local covers through it makes every request fail outright
  // (surfaced as the TTS media-session notification losing its book cover
  // and falling back to the app icon). Local URLs must stay on plain
  // `fetch`, which the WebView's own asset-protocol interceptor serves.
  test.each([
    ['asset:// scheme (desktop/mobile asset protocol)', 'asset://localhost/Books/cover.png'],
    [
      'http://asset.localhost virtual host (Android convertFileSrc)',
      'http://asset.localhost/Books/cover.png',
    ],
    ['https://asset.localhost virtual host', 'https://asset.localhost/Books/cover.png'],
    ['relative app-bundled path', '/icon.png'],
    ['blob: object URL', 'blob:http://localhost/fake-blob'],
  ])('uses plain fetch on Tauri for local URLs — %s', async (_label, url) => {
    (isTauriAppPlatform as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const result = await fetchImageAsBase64(url);

    expect(fetch).toHaveBeenCalledWith(url);
    expect(tauriFetch).not.toHaveBeenCalled();
    expect(result).toBe('data:image/jpeg;base64,AABBCC');
  });
});
