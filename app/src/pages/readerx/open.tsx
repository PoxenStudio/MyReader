import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useRouter as useAppRouter } from 'next/navigation';
import { User } from '@supabase/supabase-js';
import { IoAlertCircleOutline } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { EnvProvider, useEnv } from '@/context/EnvContext';
import { CSPostHogProvider } from '@/context/PHContext';
import { BrandHeader } from '@/components/landing/BrandHeader';
import { Card } from '@/components/landing/Card';
import { PageFooter } from '@/components/landing/PageFooter';
import { ensureMyBooksBookLocal } from '@/libs/myBooksEmbedImport';
import { navigateToReader } from '@/utils/nav';
import { setEmbedReturnUrl } from '@/utils/embedReturn';

interface WhoamiResponse {
  userId?: number;
  username?: string;
  canRead?: boolean;
  isActive?: boolean;
}

// Resolves the MyBooks origin the user actually used to get here, without
// relying on a `host` URL parameter (see document/MyReader_Embedded_WebApp.md
// §14). Correct by construction when MyReader and MyBooks share one origin
// (the only deployment implemented today); the Referer/returnUrl fallbacks
// only matter if MyReader ever becomes a shared deployment fronting several
// different MyBooks instances.
const resolveMyBooksOrigin = (returnUrl?: string): string => {
  // 1) Referer: browsers attach it automatically on a cross-origin full-page
  // navigation, and the default Referrer-Policy (strict-origin-when-cross-origin)
  // exposes just the origin cross-origin — exactly the address the user used
  // to reach MyBooks (LAN IP, external domain, any port), with no cooperation
  // needed from MyBooks or its reverse proxy.
  if (document.referrer) {
    try {
      const refOrigin = new URL(document.referrer).origin;
      if (refOrigin !== window.location.origin) return refOrigin;
    } catch {
      // Ignore an unparsable Referer and fall through.
    }
  }
  // 2) returnUrl: an existing §4 parameter MyBooks already controls, and can
  // be a full URL — not a new parameter introduced for this purpose.
  if (returnUrl) {
    try {
      return new URL(returnUrl, window.location.href).origin;
    } catch {
      // Ignore and fall through.
    }
  }
  // 3) Same-origin deployment (the only one implemented today): correct as-is.
  return window.location.origin;
};

const ReaderEmbedOpen = () => {
  const _ = useTranslation();
  const router = useRouter();
  const appRouter = useAppRouter();
  const { login } = useAuth();
  const { appService } = useEnv();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!router.isReady || !appService || started.current) return;
    started.current = true;

    const bookIdParam = router.query['bookId'];
    const bookId = Number(Array.isArray(bookIdParam) ? bookIdParam[0] : bookIdParam);
    const format = (
      Array.isArray(router.query['format']) ? router.query['format'][0] : router.query['format']
    ) as string | undefined;
    const cfi = (
      Array.isArray(router.query['cfi']) ? router.query['cfi'][0] : router.query['cfi']
    ) as string | undefined;
    const returnUrl =
      ((Array.isArray(router.query['returnUrl'])
        ? router.query['returnUrl'][0]
        : router.query['returnUrl']) as string | undefined) || `/book/${bookId}`;

    if (!bookId || Number.isNaN(bookId)) {
      setError(_('Missing or invalid book id'));
      return;
    }

    (async () => {
      try {
        const whoamiResponse = await fetch('/api/mybooks/whoami', { credentials: 'include' });
        const identity: WhoamiResponse = whoamiResponse.ok ? await whoamiResponse.json() : {};
        if (!identity.userId || !identity.canRead || !identity.isActive) {
          setError(_('Please sign in to MyBooks first'));
          return;
        }

        const host = resolveMyBooksOrigin(returnUrl);
        const sessionToken = btoa(`mybooks:${identity.userId}:${Date.now()}`);
        const mockUser = {
          id: String(identity.userId),
          email: `${identity.username || identity.userId}@mybooks.local`,
          app_metadata: {},
          user_metadata: {},
          aud: '',
          role: '',
          confirmed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as unknown as User;
        login(sessionToken, mockUser, host);

        const book = await ensureMyBooksBookLocal({ bookId, format, appService });
        setEmbedReturnUrl(book.hash, returnUrl);

        const queryParams = cfi ? `cfi=${encodeURIComponent(cfi)}` : undefined;
        navigateToReader(appRouter, [book.hash], queryParams, { scroll: false });
      } catch (err) {
        setError(err instanceof Error ? err.message : _('Could not open this book'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, appService]);

  if (error) {
    return (
      <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
        <Card>
          <div className='flex flex-col items-center text-center'>
            <div className='bg-base-200 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl'>
              <IoAlertCircleOutline className='text-base-content/60 h-8 w-8' />
            </div>
            <h1 className='text-base-content text-2xl font-semibold'>
              {_('Could not open this book')}
            </h1>
            <p className='text-base-content/70 mt-2 text-sm'>{error}</p>
          </div>
        </Card>
        <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
      </main>
    );
  }

  return (
    <main className='bg-base-200 flex min-h-dvh flex-col items-center justify-center p-4 sm:p-8'>
      <Card>
        <BrandHeader title={_('Opening your book…')} alt={_('MyReader logo')} />
        <div
          className='mt-6 flex flex-col items-center gap-3 py-4'
          role='status'
          aria-live='polite'
        >
          <span className='loading loading-dots loading-md text-primary' aria-hidden='true' />
        </div>
      </Card>
      <PageFooter tagline={_('Open-source ebook reader for everyone, on every device.')} />
    </main>
  );
};

export default function Page() {
  return (
    <CSPostHogProvider>
      <EnvProvider>
        <AuthProvider>
          <ReaderEmbedOpen />
        </AuthProvider>
      </EnvProvider>
    </CSPostHogProvider>
  );
}
