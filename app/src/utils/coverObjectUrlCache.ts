/**
 * Session-scoped cache of blob object URLs created for remote book covers,
 * keyed by the original cover URL. `BookCover` remounts on every scroll fling
 * on Android (Virtuoso tears items down outside its overscan window), and
 * without this cache each remount re-fetched the cached response blob and
 * re-ran `URL.createObjectURL`, forcing a fresh image decode and a visible
 * flash back to the fallback cover. Sharing one object URL across mounts
 * lets a remount reuse an already-decoded image.
 */

const MAX_ENTRIES = 300;

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export function peekCachedCoverObjectUrl(key: string): string | undefined {
  return urlCache.get(key);
}

function storeAndEvict(key: string, objectUrl: string): void {
  urlCache.set(key, objectUrl);
  if (urlCache.size <= MAX_ENTRIES) return;

  const oldestKey = urlCache.keys().next().value;
  if (oldestKey === undefined || oldestKey === key) return;
  const oldestUrl = urlCache.get(oldestKey);
  urlCache.delete(oldestKey);
  if (oldestUrl) URL.revokeObjectURL(oldestUrl);
}

/**
 * Returns the cached object URL for `key`, reusing an in-flight request if
 * one is already running for the same key. A failed request is not cached,
 * so the next call retries from scratch.
 */
export function getOrCreateCoverObjectUrl(
  key: string,
  createObjectUrl: () => Promise<string>,
): Promise<string> {
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const promise = createObjectUrl()
    .then((objectUrl) => {
      pending.delete(key);
      storeAndEvict(key, objectUrl);
      return objectUrl;
    })
    .catch((error: unknown) => {
      pending.delete(key);
      throw error;
    });

  pending.set(key, promise);
  return promise;
}

export function __resetCoverObjectUrlCacheForTests(): void {
  urlCache.clear();
  pending.clear();
}
