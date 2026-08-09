'use client';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import ModalPortal from '@/components/ModalPortal';
import {
  mergeTauriMyBooksCookie,
  extractCookieHeaderFromResponse,
} from '@/services/mybooks/tauriCookieStore';
import {
  setStoredMyBooksAccessCode,
  getStoredMyBooksAccessCode,
  clearStoredMyBooksAccessCode,
} from '@/utils/credentialStorage';

interface AccessCodeDialogProps {
  host: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface AccessResponse {
  err: string;
  msg?: string;
}

export function AccessCodeDialog({ host, onClose, onSuccess }: AccessCodeDialogProps) {
  const _ = useTranslation();
  const [inviteCode, setInviteCode] = useState('');
  const [rememberCode, setRememberCode] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedCode = getStoredMyBooksAccessCode();
    if (savedCode) {
      setInviteCode(savedCode);
      setRememberCode(true);
    }
  }, []);

  const handleSubmit = async () => {
    if (!inviteCode) {
      setError(_('Please enter the access code'));
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const isTauri = isTauriAppPlatform();
      const fetchFn = isTauri ? tauriFetch : fetch;
      const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
      const accessUrl = isTauri
        ? `${normalizedHost}/api/access`
        : `/api/mybooks/proxy/access?host=${encodeURIComponent(normalizedHost)}`;
      const response = await fetchFn(accessUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ invite_code: inviteCode }),
        ...(!isTauri && { credentials: 'include' as RequestCredentials }),
        ...(isTauri && { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }),
      });
      const result = (await response.json()) as AccessResponse;
      if (result.err === 'ok') {
        if (isTauri) {
          // plugin-http's own cookie jar already sees this Set-Cookie for
          // future tauriFetch calls, but the explicit-Cookie-header
          // consumers (native downloader, WS sync channel — see
          // tauriCookieStore.ts) only see what's captured here.
          const cookie = extractCookieHeaderFromResponse(response);
          if (cookie) mergeTauriMyBooksCookie(cookie);
        }
        if (rememberCode) {
          setStoredMyBooksAccessCode(inviteCode);
        } else {
          clearStoredMyBooksAccessCode();
        }
        onSuccess();
      } else {
        setError(result.msg || _('Invalid access code'));
      }
    } catch {
      setError(_('Failed to connect to server'));
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = clsx(
    'w-full rounded border p-3',
    'bg-base-100 border-base-300 hover:border-base-400',
    'text-base-content placeholder:text-base-content/40',
    'focus:outline-none focus:ring-2 focus:ring-primary/50',
  );

  return (
    <ModalPortal>
      <div className='modal-box w-full mx-4 flex flex-col gap-4' style={{ maxWidth: '420px' }}>
        <h3 className='text-lg font-bold text-base-content'>{_('Access Code Required')}</h3>

        {error && <div className='p-3 bg-red-500/10 text-red-600 rounded-lg text-sm'>{error}</div>}

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Access Code')}
          </label>
          <div className='relative'>
            <input
              type={showCode ? 'text' : 'password'}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete='off'
              placeholder={_('Enter your access code')}
              className={clsx(inputClass, 'pe-11')}
              disabled={isLoading}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
            <button
              type='button'
              onClick={() => setShowCode((v) => !v)}
              className={clsx(
                'absolute end-2 top-1/2 -translate-y-1/2',
                'flex h-8 w-8 items-center justify-center rounded',
                'text-base-content/60 hover:text-base-content',
                'hover:bg-base-200/60 transition-colors duration-150',
                'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
              )}
              aria-label={showCode ? _('Hide password') : _('Show password')}
              title={showCode ? _('Hide password') : _('Show password')}
              tabIndex={-1}
            >
              {showCode ? (
                <MdVisibilityOff className='h-4 w-4' />
              ) : (
                <MdVisibility className='h-4 w-4' />
              )}
            </button>
          </div>
          <label className='flex items-center gap-2 mt-2 text-sm text-base-content/75'>
            <input
              type='checkbox'
              checked={rememberCode}
              onChange={(e) => setRememberCode(e.target.checked)}
              disabled={isLoading}
              className='checkbox checkbox-sm'
            />
            {_('Remember access code')}
          </label>
        </div>

        <div className='flex gap-3 mt-2'>
          <button
            onClick={onClose}
            disabled={isLoading}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg',
              'border border-base-300 eink-bordered',
              'text-base-content hover:bg-base-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors font-medium',
            )}
          >
            {_('Cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg',
              'bg-primary text-primary-content btn-primary',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors font-medium',
            )}
          >
            {isLoading ? _('Signing in...') : _('Sign In')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
