import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

export interface ParsedDataUrl {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Decode a `data:` URL into raw bytes plus its MIME type. Used to turn the
 * in-memory image shown in the gallery viewer back into a file for the
 * share / export flow.
 */
export function dataUrlToBytes(dataUrl: string): ParsedDataUrl {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Not a data URL');
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3] ?? '';
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mimeType };
  }
  // Non-base64 data URLs hold percent-encoded text (e.g. inline SVG).
  return { bytes: new TextEncoder().encode(decodeURIComponent(data)), mimeType };
}

/** Derive a file extension from an image MIME type (e.g. image/svg+xml -> svg). */
export function imageExtensionFromMime(mimeType: string): string {
  const subtype = (mimeType.split('/')[1] || 'png').toLowerCase();
  const base = subtype.split('+')[0]!;
  return base === 'jpeg' ? 'jpg' : base;
}

// Strictly increasing so two saves in the same millisecond still get distinct
// names.
let lastGalleryStamp = 0;

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/**
 * A collision-free name for an image handed to the gallery. Android's MediaStore
 * neither overwrites an existing display name nor de-duplicates it consistently:
 * AOSP renames to `image (1).png`, while stricter OEM providers reject the row
 * outright. Naming each save ourselves keeps the insert independent of that.
 */
export function galleryFileName(filename: string, now = Date.now()): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  lastGalleryStamp = Math.max(now, lastGalleryStamp + 1);
  const d = new Date(lastGalleryStamp);
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const time = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
  return `myreader-${date}-${time}-${pad(d.getMilliseconds(), 3)}${ext}`;
}

/**
 * True only for a genuine external http(s) resource — the kind a NAS/MyBooks
 * host serves without CORS headers. Tauri's own asset protocol (`asset:`,
 * and its `asset.localhost`/`tauri.localhost` virtual hosts on platforms
 * that route it over http/https) and relative/blob/data URLs are all served
 * locally by the WebView itself, so `tauriFetch` — Tauri's native Rust HTTP
 * client — has no handler for them and fails outright.
 */
function isRemoteImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.hostname !== 'asset.localhost' && parsed.hostname !== 'tauri.localhost';
}

export async function fetchImageAsBase64(
  url: string,
  options: {
    targetWidth?: number;
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
    quality?: number;
  } = {},
): Promise<string> {
  const { targetWidth = 256, format = 'image/jpeg', quality = 0.85 } = options;

  try {
    // Plain `fetch` is subject to the WebView's CORS enforcement — a NAS/
    // MyBooks host's image endpoint (e.g. `/get/thumb_*`) typically has no
    // `Access-Control-Allow-Origin` header, so a cross-origin request from
    // the `tauri://localhost`/`http://tauri.localhost` origin is blocked
    // outright (seen on Android: "blocked by CORS policy"). `tauriFetch`
    // goes through Tauri's native Rust HTTP client instead, which isn't
    // subject to the WebView's CORS layer at all — but that native client
    // also can't serve local asset-protocol URLs (see isRemoteImageUrl), so
    // it's only used for genuine remote covers.
    const fetchFn =
      isTauriAppPlatform() && isRemoteImageUrl(url)
        ? (tauriFetch as unknown as typeof fetch)
        : fetch;
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();

    const img = new Image();
    img.crossOrigin = 'anonymous';

    return new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          const aspectRatio = img.height / img.width;
          const newWidth = targetWidth;
          const newHeight = Math.round(newWidth * aspectRatio);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          canvas.width = newWidth;
          canvas.height = newHeight;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.drawImage(img, 0, 0, newWidth, newHeight);

          const base64 = canvas.toDataURL(format, quality);
          resolve(base64);
        } catch (error) {
          reject(new Error(`Failed to scale image: ${error}`));
        }
      };

      img.onerror = () => reject(new Error('Failed to load image for scaling'));

      const objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;

      const cleanup = () => URL.revokeObjectURL(objectUrl);
      const originalOnload = img.onload;
      const originalOnerror = img.onerror;

      img.onload = function (ev) {
        cleanup();
        if (originalOnload) originalOnload.call(this, ev);
      };

      img.onerror = function (ev) {
        cleanup();
        if (originalOnerror) originalOnerror.call(this, ev);
      };
    });
  } catch (error) {
    console.error('Error fetching and encoding image:', error);
    throw error;
  }
}
