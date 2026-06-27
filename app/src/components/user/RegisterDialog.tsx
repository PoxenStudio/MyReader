'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

interface RegisterDialogProps {
  host: string;
  onClose: () => void;
  onSuccess: (username: string) => void;
}

interface SignUpResponse {
  err: string;
  msg: string;
}

const EMAIL_RE =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

export function RegisterDialog({ host, onClose, onSuccess }: RegisterDialogProps) {
  const _ = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
    if (!username || !password || !password2 || !nickname || !email) {
      setError(_('Please fill in all fields'));
      return;
    }
    if (username.length < 3 || username.length > 20) {
      setError(_('Username must be 3 to 20 characters'));
      return;
    }
    if (password.length < 6 || password.length > 20) {
      setError(_('Password must be 6 to 20 characters'));
      return;
    }
    if (password !== password2) {
      setError(_('Passwords do not match'));
      return;
    }
    if (nickname.length < 2) {
      setError(_('Nickname must be at least 2 characters'));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError(_('Invalid email address'));
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const isTauri = isTauriAppPlatform();
      const fetchFn = isTauri ? tauriFetch : fetch;
      const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
      const signUpUrl = isTauri
        ? `${normalizedHost}/api/user/sign_up`
        : `/api/mybooks/proxy/user/sign_up?host=${encodeURIComponent(normalizedHost)}`;
      const response = await fetchFn(signUpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ username, password, nickname, email }).toString(),
        ...(!isTauri && { credentials: 'include' as RequestCredentials }),
        ...(isTauri && { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }),
      });
      const result = (await response.json()) as SignUpResponse;
      if (result.err === 'ok') {
        onSuccess(username);
      } else {
        setError(result.msg || _('Registration failed'));
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
      <div className='modal-box w-full mx-4 flex flex-col gap-4' style={{ maxWidth: '480px' }}>
        <h3 className='text-lg font-bold text-base-content'>{_('Register')}</h3>

        {error && <div className='p-3 bg-red-500/10 text-red-600 rounded-lg text-sm'>{error}</div>}

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Username')}
          </label>
          <input
            type='text'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete='new-username'
            placeholder={_('3 to 20 characters')}
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Password')}
          </label>
          <input
            type='password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete='new-password'
            placeholder={_('6 to 20 characters')}
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Confirm Password')}
          </label>
          <input
            type='password'
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete='new-password'
            placeholder={_('Repeat your password')}
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Nickname')}
          </label>
          <input
            type='text'
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoComplete='new-nickname'
            placeholder={_('At least 2 characters')}
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-base-content/75 mb-1'>
            {_('Email')}
          </label>
          <input
            type='email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete='new-email'
            placeholder='user@example.com'
            className={inputClass}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSignUp();
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
            onClick={handleSignUp}
            disabled={isLoading}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg',
              'bg-primary text-primary-content btn-primary',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors font-medium',
            )}
          >
            {isLoading ? _('Registering...') : _('Register')}
          </button>
        </div>
      </div>
    </div>
  );
}
