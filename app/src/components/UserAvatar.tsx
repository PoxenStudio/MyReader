import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { IconType } from 'react-icons';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

interface UserAvatarProps {
  url: string;
  size: number;
  DefaultIcon: IconType;
  className?: string;
  borderClassName?: string;
  /**
   * When true, the root box stretches via h-full/w-full instead of getting
   * the explicit `size` pinned via inline style. Use this when a parent
   * constrains the avatar with its own (responsive) classes — otherwise the
   * inline style overrides the parent box and the avatar can overflow on
   * smaller breakpoints. `size` is still used as the intrinsic dimension
   * for next/image and the fallback icon.
   */
  fillContainer?: boolean;
}

const getStorageKey = (url: string) => {
  return `avatar_${btoa(url).replace(/[^a-zA-Z0-9]/g, '')}`;
};

// Cache entries written before response validation existed could be a data
// URI of a non-image response (e.g. an HTML login page). Treat those as
// absent so a stale bad cache doesn't permanently block re-fetching.
const readValidCachedImage = (storageKey: string): string | null => {
  const cached = localStorage.getItem(storageKey);
  if (cached && !cached.startsWith('data:image/')) {
    localStorage.removeItem(storageKey);
    return null;
  }
  return cached;
};

const UserAvatar: React.FC<UserAvatarProps> = ({
  url,
  size,
  className,
  borderClassName,
  DefaultIcon,
  fillContainer,
}) => {
  const [cachedImageUrl, setCachedImageUrl] = useState<string | null>(() => {
    if (!url) return null;

    return readValidCachedImage(getStorageKey(url));
  });

  useEffect(() => {
    if (!url) return;

    const storageKey = getStorageKey(url);
    const cached = readValidCachedImage(storageKey);

    if (cached && cached === cachedImageUrl) {
      return;
    }

    const cacheImage = async () => {
      try {
        // Tauri's HTTP plugin owns its own native cookie jar (invisible to
        // the webview) and has no API-route server in production builds, so
        // the MyBooks session cookie can only be attached via tauriFetch.
        const response = isTauriAppPlatform()
          ? await (tauriFetch as unknown as typeof fetch)(url)
          : await fetch(url, { referrerPolicy: 'no-referrer' });
        if (!response.ok) {
          throw new Error(`Avatar request failed with status ${response.status}`);
        }
        const contentType = response.headers.get('Content-Type') ?? '';
        if (!contentType.startsWith('image/')) {
          throw new Error(`Avatar response was not an image (Content-Type: ${contentType})`);
        }
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          try {
            localStorage.setItem(storageKey, base64data);
            setCachedImageUrl(base64data);
          } catch (e) {
            console.warn('Failed to cache avatar in localStorage:', e);
          }
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        console.error('Failed to cache avatar:', error);
      }
    };

    cacheImage();
  }, [url, cachedImageUrl]);

  // In Tauri, `url` points directly at the upstream host and can't be
  // authenticated by a plain <img> request — only show it once cached.
  const displaySrc = cachedImageUrl || (isTauriAppPlatform() ? null : url);

  return (
    <div
      className='relative flex h-full w-full items-center justify-center rounded-full'
      style={fillContainer ? undefined : { width: size, height: size }}
    >
      {displaySrc ? (
        <div>
          <Image
            src={displaySrc}
            alt='User Avatar'
            className={clsx('rounded-full', className, borderClassName)}
            referrerPolicy='no-referrer'
            width={size}
            height={size}
            color='lightgray'
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('invisible');
            }}
          />
          <div className='invisible absolute inset-0 flex items-center justify-center'>
            <DefaultIcon className={clsx('text-neutral-content', className)} />
          </div>
        </div>
      ) : (
        <DefaultIcon className='text-neutral-content' size={size} />
      )}
    </div>
  );
};

export default UserAvatar;
