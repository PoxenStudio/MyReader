'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

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
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='modal-box w-full mx-4 flex flex-col gap-4' style={{ maxWidth: '420px' }}>
        <h3 className='text-lg font-bold text-base-content'>{_('Access Code Required')}</h3>

        {error && <div className='p-3 bg-red-500/10 text-red-600 rounded-lg text-sm'>{error}</div>}

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Access Code')}
          </label>
          <input
            type='text'
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder={_('Enter your access code')}
            className={inputClass}
            disabled={isLoading}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
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
    </div>
  );
}
