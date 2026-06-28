import clsx from 'clsx';
import Image from 'next/image';
import { memo, useEffect, useRef, useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { info, error as tauriError } from '@tauri-apps/plugin-log';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';
import { isTauriAppPlatform } from '@/services/environment';

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
    const objectUrlRef = useRef<string | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);

    const shouldShowSpine = showSpine && imageLoaded && !imageError;

    useEffect(() => {
      return () => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      };
    }, []);

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
      const coverUrl = book.metadata?.coverImageUrl || book.coverImageUrl;
      if (!coverUrl) {
        toggleImageVisibility(false);
        return;
      }

      const isLocalAssetUrl =
        coverUrl.startsWith('asset://') || coverUrl.includes('asset.localhost');
      const isRemoteUrl =
        !isLocalAssetUrl && (coverUrl.startsWith('http://') || coverUrl.startsWith('https://'));

      if (!isTauriAppPlatform() || !isRemoteUrl) {
        setDisplayImageUrl(coverUrl);
        toggleImageVisibility(true);
        return;
      }

      const fetchCover = async () => {
        try {
          const cachedResponse = await getCachedCover(coverUrl);
          if (cachedResponse) {
            info(`[BookCover] Using cached cover for book: ${book.title} (${book.hash})`).catch(
              () => {},
            );
            const blob = await cachedResponse.blob();
            const objectUrl = URL.createObjectURL(blob);
            objectUrlRef.current = objectUrl;
            setDisplayImageUrl(objectUrl);
            toggleImageVisibility(true);
            return;
          }

          info(`[BookCover] Fetching remote cover for book: ${book.title} (${book.hash})`).catch(
            () => {},
          );
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
          info(
            `[BookCover] Remote cover blob size: ${blob.size} bytes, type: ${contentType}`,
          ).catch(() => {});

          const objectUrl = URL.createObjectURL(blob);
          objectUrlRef.current = objectUrl;
          setDisplayImageUrl(objectUrl);
          toggleImageVisibility(true);
          info(
            `[BookCover] Remote cover loaded and cached for book: ${book.title} (${book.hash})`,
          ).catch(() => {});
        } catch (error) {
          const errorMsg = `[BookCover] Failed to fetch remote cover for book: ${book.title} (${book.hash}): ${error}`;
          console.error(errorMsg);
          tauriError(errorMsg).catch(() => {});
          toggleImageVisibility(false);
        }
      };

      fetchCover();
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
