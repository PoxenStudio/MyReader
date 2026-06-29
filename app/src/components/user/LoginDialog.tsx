'use client';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { User } from '@supabase/supabase-js';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import {
  MYBOOKS_PASSWORD_KEY,
  getStoredMyBooksPassword,
  setStoredMyBooksPassword,
  setSessionMyBooksPassword,
} from '@/utils/credentialStorage';
import {
  getMyBooksHostHistory,
  addMyBooksHostToHistory,
  getMyBooksUsernameHistory,
  addMyBooksUsernameToHistory,
} from '@/utils/mybooksHistory';
import { debounce } from '@/utils/debounce';
import { RegisterDialog } from '@/components/user/RegisterDialog';
import Dialog from '@/components/Dialog';
import { useAuthUIStore } from '@/store/authUIStore';
import {
  setTauriMyBooksCookie,
  extractCookieHeaderFromResponse,
} from '@/services/mybooks/tauriCookieStore';

interface MyBooksLoginResponse {
  err: string;
  msg: string;
  data?: {
    user_id?: number;
    username?: string;
    name?: string;
    email?: string;
  };
}

interface MyBooksUserInfoResponse {
  err: string;
  user?: {
    id?: number;
    username?: string;
    nickname?: string;
    email?: string;
    avatar?: string;
    is_admin?: boolean;
    is_login?: boolean;
  };
  sys?: {
    allow?: {
      register?: boolean;
      download?: boolean;
      upload?: boolean;
      physical_books?: boolean;
      read?: boolean;
      sync?: boolean;
    };
  };
}

const MYBOOKS_HOST_KEY = 'mybooks_host';
const MYBOOKS_USERNAME_KEY = 'mybooks_username';
const MYBOOKS_REMEMBER_KEY = 'mybooks_remember';

const normalizeHost = (host: string) => (host.endsWith('/') ? host.slice(0, -1) : host);

const isValidHost = (host: string): boolean => {
  try {
    const parsed = new URL(host);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const fetchMyBooksUserInfo = async (host: string): Promise<MyBooksUserInfoResponse> => {
  const isTauri = isTauriAppPlatform();
  const fetchFn = isTauri ? tauriFetch : fetch;
  const normalizedHost = normalizeHost(host);
  const infoUrl = isTauri
    ? `${normalizedHost}/api/user/info`
    : `/api/mybooks/proxy/user/info?host=${encodeURIComponent(normalizedHost)}`;
  const response = await fetchFn(infoUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    ...(!isTauri && { credentials: 'include' as RequestCredentials }),
    ...(isTauri && { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } }),
  });
  return (await response.json()) as MyBooksUserInfoResponse;
};

const LoginDialog: React.FC = () => {
  const _ = useTranslation();
  const { login, loginAsGuest } = useAuth();
  const isOpen = useAuthUIStore((state) => state.isLoginDialogOpen);
  const closeLoginDialog = useAuthUIStore((state) => state.closeLoginDialog);

  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [hostHistory, setHostHistory] = useState<string[]>([]);
  const [usernameHistory, setUsernameHistory] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingRegister, setIsCheckingRegister] = useState(false);
  const [error, setError] = useState('');
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  // Whether the configured MyBooks host currently allows registration. Defaults
  // to true so the button isn't hidden while we haven't checked yet (e.g. host
  // field still empty/unvalidated) — it's only hidden once the server explicitly
  // reports allow.register === false.
  const [allowRegister, setAllowRegister] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setHostHistory(getMyBooksHostHistory());
    setUsernameHistory(getMyBooksUsernameHistory());

    const savedHost = localStorage.getItem(MYBOOKS_HOST_KEY);
    const savedUsername = localStorage.getItem(MYBOOKS_USERNAME_KEY);
    const savedRemember = localStorage.getItem(MYBOOKS_REMEMBER_KEY) === 'true';
    if (savedHost) setHost(savedHost);
    if (savedUsername) setUsername(savedUsername);
    if (savedRemember) {
      setRememberCredentials(true);
      const savedPassword = getStoredMyBooksPassword();
      if (savedPassword) setPassword(savedPassword);
    }
  }, [isOpen]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkAllowRegister = useCallback(
    debounce((hostValue: string) => {
      if (!isValidHost(hostValue)) {
        setAllowRegister(true);
        return;
      }
      fetchMyBooksUserInfo(hostValue)
        .then((result) => {
          setAllowRegister(result.sys?.allow?.register !== false);
        })
        .catch(() => {
          // Can't reach the host yet (e.g. still typing it) — don't hide the
          // button on a transient/network failure, only on an explicit false.
          setAllowRegister(true);
        });
    }, 500),
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    checkAllowRegister(host);
  }, [isOpen, host, checkAllowRegister]);

  const handleClose = () => {
    setError('');
    closeLoginDialog();
  };

  const handleLogin = async () => {
    if (!host || !username || !password) {
      setError(_('Please fill in all fields'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const isTauri = isTauriAppPlatform();
      const fetchFn = isTauri ? tauriFetch : fetch;
      const normalizedHost = normalizeHost(host);
      const signInUrl = isTauri
        ? `${normalizedHost}/api/user/sign_in`
        : `/api/mybooks/proxy/user/sign_in?host=${encodeURIComponent(normalizedHost)}`;
      const response = await fetchFn(signInUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ username, password }).toString(),
        ...(!isTauri && { credentials: 'include' as RequestCredentials }),
        ...(isTauri && {
          danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
        }),
      });

      let result: MyBooksLoginResponse;
      try {
        result = (await response.json()) as MyBooksLoginResponse;
      } catch {
        console.error('Non-JSON response:', response.status, response.statusText, response.body);
        setError(_('Failed to connect to server'));
        return;
      }

      if (result.err === 'permission.inactive') {
        setError(
          _(
            'Account not activated. Please check your registration email to complete activation or contact the administrator.',
          ),
        );
      } else if (result.err === 'ok') {
        const userId = result.data?.user_id?.toString() ?? '1';
        const mockUser = {
          id: userId,
          email: result.data?.email || `${username}@example.com`,
          app_metadata: {},
          user_metadata: {},
          aud: '',
          role: '',
          confirmed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const sessionToken = btoa(`mybooks:${userId}:${Date.now()}`);
        if (isTauri) {
          const cookie = extractCookieHeaderFromResponse(response);
          if (cookie) setTauriMyBooksCookie(cookie);
        }
        localStorage.setItem(MYBOOKS_USERNAME_KEY, username);
        addMyBooksHostToHistory(host);
        addMyBooksUsernameToHistory(username);
        setSessionMyBooksPassword(password);
        if (rememberCredentials) {
          setStoredMyBooksPassword(password);
          localStorage.setItem(MYBOOKS_REMEMBER_KEY, 'true');
        } else {
          localStorage.removeItem(MYBOOKS_PASSWORD_KEY);
          localStorage.removeItem(MYBOOKS_REMEMBER_KEY);
        }
        login(sessionToken, mockUser as unknown as User, host);
        handleClose();
      } else {
        console.log('Login response status: ', response.status);
        console.log('Login response status text: ', response.statusText);
        console.log('Login response body: ', response.body);
        console.log('Login response:', result);
        setError(result.msg || _('Login failed') + ':' + result.err);
      }
    } catch (err) {
      console.error('Login failed:', err);
      setError(_('Failed to connect to server'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueAsGuest = () => {
    if (!host) {
      setError(_('Please enter the host address'));
      return;
    }
    if (!isValidHost(host)) {
      setError(_('Please enter a valid http/https host address'));
      return;
    }
    setError('');
    addMyBooksHostToHistory(host);
    loginAsGuest(host);
    handleClose();
  };

  const handleRegisterClick = async () => {
    if (!host) {
      setError(_('Please enter the host address'));
      return;
    }
    if (!isValidHost(host)) {
      setError(_('Please enter a valid http/https host address'));
      return;
    }

    setError('');
    setIsCheckingRegister(true);
    try {
      const result = await fetchMyBooksUserInfo(host);
      if (result.sys?.allow?.register !== false) {
        setShowRegisterDialog(true);
      } else {
        setAllowRegister(false);
        setError(_('Registration is not allowed on this server'));
      }
    } catch {
      setError(_('Failed to connect to server'));
    } finally {
      setIsCheckingRegister(false);
    }
  };

  const inputClass = clsx(
    'w-full rounded border p-3',
    'bg-base-100 border-base-300 hover:border-base-400',
    'text-base-content placeholder:text-base-content/40',
    'focus:outline-none focus:ring-2 focus:ring-primary/50',
  );

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={handleClose}
        title={_('Login')}
        header={<></>}
        boxClassName='sm:h-auto sm:max-h-[85vh] sm:w-[70%] sm:max-w-[840px]'
        contentClassName='!mx-0 !my-0 flex !overflow-hidden !px-0'
      >
        <button
          aria-label={_('Close')}
          onClick={handleClose}
          className='btn btn-ghost btn-circle absolute top-3 end-3 z-30 flex h-8 min-h-8 w-8 bg-base-100/70 hover:bg-base-100 focus:outline-none'
        >
          <MdClose size={18} />
        </button>
        <div
          className='login-dialog-art hidden shrink-0 basis-2/5 relative overflow-hidden sm:flex'
          style={{ backgroundColor: '#f4ecd8' }}
        >
          <div className='absolute inset-x-0 bottom-0 h-1/2'>
            {/* biome-ignore lint/a11y/useAltText: decorative-only, hidden via aria-hidden */}
            <object
              type='image/svg+xml'
              data='/images/background/waves.svg'
              aria-hidden='true'
              tabIndex={-1}
              className='h-full w-full'
            />
          </div>
        </div>
        <div className='flex w-full flex-1 flex-col items-center overflow-y-auto px-6 py-4 sm:px-[10%]'>
          <h2 className='w-full mb-4 text-xl font-bold text-base-content'>{_('Login')}</h2>
          {error && (
            <div className='w-full mb-4 p-3 bg-red-500/10 text-red-600 rounded-lg text-sm'>
              {error}
            </div>
          )}

          <div className='w-full mb-4'>
            <label className='block text-sm font-medium text-base-content/75 mb-2'>
              {_('Host Address')}
            </label>
            <input
              type='url'
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder='https://your-mybooks-server.com'
              list='mybooks-host-history'
              className={inputClass}
              disabled={isLoading}
            />
            <datalist id='mybooks-host-history'>
              {hostHistory.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </div>

          <div className='w-full mb-4'>
            <label className='block text-sm font-medium text-base-content/75 mb-2'>
              {_('Username')}
            </label>
            <input
              type='text'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={_('Your username')}
              list='mybooks-username-history'
              className={inputClass}
              disabled={isLoading}
            />
            <datalist id='mybooks-username-history'>
              {usernameHistory.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </div>

          <div className='w-full mb-4'>
            <label className='block text-sm font-medium text-base-content/75 mb-2'>
              {_('Password')}
            </label>
            <input
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete='new-password'
              placeholder={_('Your password')}
              className={inputClass}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleLogin();
                }
              }}
            />
          </div>

          <div className='w-full mb-6 flex items-center gap-2'>
            <input
              id='remember-credentials'
              type='checkbox'
              checked={rememberCredentials}
              onChange={(e) => {
                const checked = e.target.checked;
                setRememberCredentials(checked);
                if (!checked) {
                  localStorage.removeItem(MYBOOKS_PASSWORD_KEY);
                  localStorage.removeItem(MYBOOKS_REMEMBER_KEY);
                }
              }}
              className='checkbox checkbox-sm checkbox-primary'
              disabled={isLoading}
            />
            <label
              htmlFor='remember-credentials'
              className='text-sm text-base-content/75 cursor-pointer select-none'
            >
              {_('Remember Credentials')}
            </label>
          </div>

          <button
            onClick={handleLogin}
            disabled={isLoading}
            className={clsx(
              'w-full py-3 px-4 rounded-lg',
              'bg-primary text-primary-content btn-primary',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors font-medium',
            )}
          >
            {isLoading ? _('Signing in...') : _('Sign In')}
          </button>

          <button
            onClick={handleContinueAsGuest}
            disabled={isLoading}
            className={clsx(
              'w-full mt-3 py-3 px-4 rounded-lg',
              'bg-transparent border border-base-300 eink-bordered',
              'text-base-content hover:bg-base-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors font-medium',
            )}
          >
            {_('Continue as Guest')}
          </button>

          {allowRegister && (
            <button
              onClick={handleRegisterClick}
              disabled={isLoading || isCheckingRegister}
              className={clsx(
                'w-full mt-3 py-2 px-4 rounded-lg',
                'text-base-content/70 hover:text-base-content',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-colors text-sm font-medium underline underline-offset-4',
              )}
            >
              {isCheckingRegister ? _('Checking...') : _('Register')}
            </button>
          )}
        </div>
      </Dialog>

      {showRegisterDialog && (
        <RegisterDialog
          host={host}
          onClose={() => setShowRegisterDialog(false)}
          onSuccess={(registeredUsername) => {
            setShowRegisterDialog(false);
            setUsername(registeredUsername);
          }}
        />
      )}
    </>
  );
};

export default LoginDialog;
