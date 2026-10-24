'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { IoAlertCircleOutline } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { Card } from '@/components/landing/Card';
import { PageFooter } from '@/components/landing/PageFooter';
import { isLocalDbDisabled, isWebAppPlatform } from '@/services/environment';

interface WhoamiResponse {
  userId?: number;
  username?: string;
  canRead?: boolean;
  isActive?: boolean;
  is_guest?: boolean;
  err?: string;
  msg?: string;
}

// The reader entry points (`/readerx/open` and the `/reader/[ids]` it lands on)
// are served by MyReader, not MyBooks: nginx routes those prefixes straight to
// the MyReader upstream (see conf/nginx/mybooks.conf), so MyBooks' REQUIRE_LOGIN
// gate never runs for them. `/readerx/open` already checks whoami before
// importing a book, but the `/reader/<hash>` page itself did not — once a book
// reached the local library (e.g. via a share link), anyone could reopen it by
// URL even with REQUIRE_LOGIN on and ALLOW_GUEST_READ off.
//
// Only the merged self-hosted deployment needs this: there MyReader has no
// library UI of its own and every book arrives through the embedded entry
// point. The hosted web app / Tauri build keep their offline+local reading
// semantics untouched.
const isEmbedGateEnabled = () => isWebAppPlatform() && isLocalDbDisabled();

type GateState = 'checking' | 'allowed' | 'denied';

/**
 * Decides whether a `whoami` payload grants read access to the embedded reader:
 * a global/share guest (`is_guest`), or a logged-in user with read permission
 * and an active account. The MyBooks side returns `user.need_login` (no
 * `userId`/`is_guest`) when neither applies.
 */
export const isWhoamiPermitted = (identity: WhoamiResponse): boolean =>
  identity.is_guest === true ||
  (Boolean(identity.userId) && identity.canRead === true && identity.isActive === true);

/**
 * Wraps the reader so the same authority MyBooks applies to its own reading
 * routes also covers the embedded reader: `GET /api/user/whoami` (reached via
 * the server-side bridge in pages/api/mybooks/whoami.ts, which forwards the
 * browser's cookies) returns an identity only when the caller is logged in with
 * read permission, holds a valid share grant, or is a global guest
 * (ALLOW_GUEST_READ / a public guest-read booklist). Otherwise it replies
 * `user.need_login` — exactly the REQUIRE_LOGIN / ALLOW_GUEST_READ outcome the
 * share landing page already respects.
 */
export const ReaderAccessGuard = ({ children }: { children: React.ReactNode }) => {
  const _ = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<GateState>(isEmbedGateEnabled() ? 'checking' : 'allowed');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isEmbedGateEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/mybooks/whoami', { credentials: 'include' });
        const identity: WhoamiResponse = response.ok ? await response.json() : {};
        const permitted = isWhoamiPermitted(identity);
        if (cancelled) return;
        if (permitted) {
          setState('allowed');
          return;
        }
        setMessage(identity.msg || _('Please sign in to MyBooks first'));
        setState('denied');
      } catch {
        if (!cancelled) {
          setMessage(_('Failed to connect to server'));
          setState('denied');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'allowed') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className='bg-base-100 flex min-h-dvh items-center justify-center'>
        <span className='loading loading-dots loading-md text-primary' aria-hidden='true' />
      </div>
    );
  }

  const loginUrl = `/login/?next=${encodeURIComponent(router.asPath || '/')}`;
  return (
    <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
      <Card>
        <div className='flex flex-col items-center text-center'>
          <div className='bg-base-200 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
            <IoAlertCircleOutline className='text-base-content/60 h-8 w-8' />
          </div>
          <h1 className='text-base-content text-2xl font-semibold'>
            {_('Please sign in to MyBooks first')}
          </h1>
          {message && message !== _('Please sign in to MyBooks first') && (
            <p className='text-base-content/70 mt-2 text-sm'>{message}</p>
          )}
          <a href={loginUrl} className='btn btn-primary mt-6'>
            {_('Login')}
          </a>
        </div>
      </Card>
      <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
    </main>
  );
};

export default ReaderAccessGuard;
