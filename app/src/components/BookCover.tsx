import clsx from 'clsx';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { info, error as tauriError } from '@tauri-apps/plugin-log';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';
import { isTauriAppPlatform } from '@/services/environment';
import { isRemoteImageUrl } from '@/utils/image';
import { getOrCreateCoverObjectUrl, peekCachedCoverObjectUrl } from '@/utils/coverObjectUrlCache';

const COVER_CACHE_NAME = 'myreader-book-covers-v1';

async function getCachedCover(url: string): Promise<Response | null> {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(COVER_CACHE_NAME);
    const response = await cache.match(url);
    return response ?? null;
  } catch {
    return null;
  }
}

async function cacheCover(url: string, response: Response): Promise<void> {
  try {
    if (!('caches' in window)) return;
    const cache = await caches.open(COVER_CACHE_NAME);
    await cache.put(url, response.clone());
  } catch {}
}

function resolveCoverUrl(book: Book): string | null {
  return book.metadata?.coverImageUrl || book.coverImageUrl || null;
}

/** True for a cover that needs the async fetch/cache-api path below. */
function isRemoteCoverUrl(coverUrl: string): boolean {
  return isTauriAppPlatform() && isRemoteImageUrl(coverUrl);
}

/**
 * Fetches a remote cover (via the Cache API first, then the network) and
 * returns a blob object URL for it. Callers should route this through
 * `getOrCreateCoverObjectUrl` so concurrent/repeat mounts for the same cover
 * share one object URL instead of re-decoding the image each time.
 */
async function fetchRemoteCoverObjectUrl(
  coverUrl: string,
  title: string,
  hash: string,
): Promise<string> {
  const cachedResponse = await getCachedCover(coverUrl);
  if (cachedResponse) {
    info(`[BookCover] Using cached cover for book: ${title} (${hash})`).catch(() => {});
    const blob = await cachedResponse.blob();
    return URL.createObjectURL(blob);
  }

  info(`[BookCover] Fetching remote cover for book: ${title} (${hash})`).catch(() => {});
  info(`[BookCover] Cover URL: ${coverUrl}`).catch(() => {});

  const response = await (tauriFetch as unknown as typeof fetch)(coverUrl, {
    method: 'GET',
    headers: {
      Accept: 'image/*',
    },
  });

  if (!response.ok) {
    const errorMsg = `[BookCover] Remote cover request failed with status ${response.status}: ${coverUrl}`;
    console.error(errorMsg);
    tauriError(errorMsg).catch(() => {});
    throw new Error(`Cover request failed with status ${response.status}`);
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.startsWith('image/')) {
    const errorMsg = `[BookCover] Remote cover response was not an image (Content-Type: ${contentType}): ${coverUrl}`;
    console.error(errorMsg);
    tauriError(errorMsg).catch(() => {});
    throw new Error(`Cover response was not an image (Content-Type: ${contentType})`);
  }

  await cacheCover(coverUrl, response);

  const blob = await response.blob();
  info(`[BookCover] Remote cover blob size: ${blob.size} bytes, type: ${contentType}`).catch(
    () => {},
  );

  const objectUrl = URL.createObjectURL(blob);
  info(`[BookCover] Remote cover loaded and cached for book: ${title} (${hash})`).catch(() => {});
  return objectUrl;
}

interface BookCoverProps {
  book: Book;
  mode?: LibraryViewModeType;
  coverFit?: LibraryCoverFitType;
  className?: string;
  imageClassName?: string;
  showSpine?: boolean;
  isPreview?: boolean;
  onImageError?: () => void;
  onAspectRatioChange?: (ratio: number) => void;
}

const BookCover: React.FC<BookCoverProps> = memo<BookCoverProps>(
  ({
    book,
    mode = 'grid',
    coverFit = 'crop',
    showSpine = false,
    className,
    imageClassName,
    isPreview,
    onImageError,
    onAspectRatioChange,
  }) => {
    const coverRef = useRef<HTMLDivElement>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    // Lazily resolved so a book whose cover is already known synchronously
    // (a local asset URL, or a remote cover already decoded by an earlier
    // mount) paints with its real cover on the very first render instead of
    // a null -> fallback -> real-cover sequence. That sequence is what
    // caused the flicker: Virtuoso unmounts/remounts BookCover on every
    // Android fling that crosses its overscan window, so covers were
    // re-running that sequence dozens of times per scroll gesture.
    const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(() => {
      const coverUrl = resolveCoverUrl(book);
      if (!coverUrl) return null;
      if (!isRemoteCoverUrl(coverUrl)) return coverUrl;
      return peekCachedCoverObjectUrl(coverUrl) ?? null;
    });

    const shouldShowSpine = showSpine && imageLoaded && !imageError;

    const toggleImageVisibility = (showImage: boolean) => {
      if (coverRef.current) {
        const coverImage = coverRef.current.querySelector('.cover-image');
        const fallbackCover = coverRef.current.querySelector('.fallback-cover');
        if (coverImage) {
          coverImage.classList.toggle('invisible', !showImage);
        }
        if (fallbackCover) {
          fallbackCover.classList.toggle('invisible', showImage);
        }
      }
    };

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      setImageLoaded(true);
      setImageError(false);
      toggleImageVisibility(true);
      const img = e.currentTarget;
      if (onAspectRatioChange && img.naturalWidth > 0 && img.naturalHeight > 0) {
        onAspectRatioChange(img.naturalWidth / img.naturalHeight);
      }
    };

    const handleImageError = () => {
      setImageLoaded(false);
      setImageError(true);
      toggleImageVisibility(false);
      onImageError?.();
    };

    useEffect(() => {
      const coverUrl = resolveCoverUrl(book);
      if (!coverUrl) {
        toggleImageVisibility(false);
        return;
      }

      if (!isRemoteCoverUrl(coverUrl)) {
        setDisplayImageUrl(coverUrl);
        toggleImageVisibility(true);
        return;
      }

      const cached = peekCachedCoverObjectUrl(coverUrl);
      if (cached) {
        setDisplayImageUrl(cached);
        toggleImageVisibility(true);
        return;
      }

      let cancelled = false;
      const { title, hash } = book;

      getOrCreateCoverObjectUrl(coverUrl, () => fetchRemoteCoverObjectUrl(coverUrl, title, hash))
        .then((objectUrl) => {
          if (cancelled) return;
          setDisplayImageUrl(objectUrl);
          toggleImageVisibility(true);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const errorMsg = `[BookCover] Failed to fetch remote cover for book: ${title} (${hash}): ${error}`;
          console.error(errorMsg);
          tauriError(errorMsg).catch(() => {});
          toggleImageVisibility(false);
        });

      return () => {
        cancelled = true;
      };
    }, [book.metadata?.coverImageUrl, book.coverImageUrl, book.hash, book.title]);

    const hasDisplayUrl = !!displayImageUrl;

    return (
      <div
        ref={coverRef}
        className={clsx('book-cover-container relative flex h-full w-full', className)}
      >
        {coverFit === 'crop' ? (
          <>
            {hasDisplayUrl && (
              <Image
                src={displayImageUrl!}
                alt={book.title}
                fill={true}
                loading='lazy'
                draggable={false}
                className={clsx('cover-image crop-cover-img object-cover', imageClassName)}
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
            )}
            <div
              className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
            />
          </>
        ) : (
          <div className={clsx('flex h-full w-full justify-start')}>
            <div
              className={clsx(
                'flex h-full max-h-full items-end',
                mode === 'grid' ? 'items-end' : 'items-center',
              )}
            >
              {hasDisplayUrl && (
                <Image
                  src={displayImageUrl!}
                  alt={book.title}
                  width={0}
                  height={0}
                  sizes='100vw'
                  loading='lazy'
                  draggable={false}
                  className={clsx(
                    'cover-image fit-cover-img h-auto max-h-full w-auto max-w-full shadow-md',
                    imageClassName,
                  )}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )}
              <div
                className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
              />
            </div>
          </div>
        )}

        <div
          className={clsx(
            'fallback-cover invisible absolute inset-0 p-2',
            'text-neutral-content text-center font-serif font-medium',
            isPreview ? 'bg-base-200/50' : 'bg-base-100',
            imageClassName,
            !hasDisplayUrl && '!visible',
          )}
        >
          <div className='flex h-1/2 items-center justify-center'>
            <span
              className={clsx(
                isPreview ? 'line-clamp-2' : mode === 'grid' ? 'line-clamp-3' : 'line-clamp-2',
                isPreview ? 'text-[0.5em]' : mode === 'grid' ? 'text-lg' : 'text-sm',
              )}
            >
              {formatTitle(book.title)}
            </span>
          </div>
          <div className='h-1/6'></div>
          <div className='flex h-1/3 items-center justify-center'>
            <span
              className={clsx(
                'text-neutral-content/50 line-clamp-1',
                isPreview ? 'text-[0.4em]' : mode === 'grid' ? 'text-base' : 'text-xs',
              )}
            >
              {formatAuthors(book.author || book.metadata?.author || '')}
            </span>
          </div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.coverImageUrl === nextProps.book.coverImageUrl &&
      prevProps.book.metadata?.coverImageUrl === nextProps.book.metadata?.coverImageUrl &&
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.mode === nextProps.mode &&
      prevProps.coverFit === nextProps.coverFit &&
      prevProps.isPreview === nextProps.isPreview &&
      prevProps.showSpine === nextProps.showSpine &&
      prevProps.className === nextProps.className &&
      prevProps.imageClassName === nextProps.imageClassName
    );
  },
);

BookCover.displayName = 'BookCover';

export default BookCover;
