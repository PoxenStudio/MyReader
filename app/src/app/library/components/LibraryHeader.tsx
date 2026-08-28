import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSearch } from 'react-icons/fa';
import { PiPlus } from 'react-icons/pi';
import { PiSelectionAll, PiSelectionAllFill } from 'react-icons/pi';
import { PiDotsThreeCircle } from 'react-icons/pi';
import {
  MdOutlineMenu,
  MdOutlineCloudOff,
  MdOutlineCloudQueue,
  MdPersonOutline,
  MdOutlineNoAccounts,
  MdExpandMore,
} from 'react-icons/md';
import { IoMdCloseCircle } from 'react-icons/io';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useMyBooksConnectionStatus, useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { useAuth } from '@/context/AuthContext';
import { useAuthUIStore } from '@/store/authUIStore';
import {
  checkMyBooksConnectivity,
  getUserInfo,
  getMyBooksAvatarUrl,
  MyBooksApiError,
  type MyBooksUserInfo,
} from '@/services/mybooksService';
import { AccessCodeDialog } from '@/components/user/AccessCodeDialog';
import { refreshTauriAccessCodeCookie } from '@/services/mybooks/accessCodeRefresh';
import { hasTauriMyBooksCookieNamed } from '@/services/mybooks/tauriCookieStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { debounce } from '@/utils/debounce';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import UserAvatar from '@/components/UserAvatar';
import UserSettingsDialog from '@/components/user/UserSettingsDialog';
import SettingsMenu from './SettingsMenu';
import ImportMenu from './ImportMenu';
import ViewMenu from './ViewMenu';
import SearchCategoryMenu from './SearchCategoryMenu';
import {
  SEARCH_CATEGORIES,
  SearchCategory,
  getBookshelfTitleKey,
} from '@/app/library/utils/libraryUtils';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  isCloudLibrary: boolean;
  isDrawerOpen: boolean;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onOpenCatalogManager: () => void;
  onOpenFeeds: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleDrawer: () => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  isCloudLibrary,
  isDrawerOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
  onOpenFeeds,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
  onToggleDrawer,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf } = useLibraryStore();
  const connectionStatus = useMyBooksConnectionStatus();
  const { status, isGuest, setIsAdmin, host, logout } = useAuth();
  const openLoginDialog = useAuthUIStore((state) => state.openLoginDialog);
  const { setSettingsDialogOpen, setRequestedPanel } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('q') ?? '');
  const [searchCategory, setSearchCategory] = useState<SearchCategory>(
    () => (searchParams?.get('cat') as SearchCategory) || 'local',
  );
  const [userInfo, setUserInfo] = useState<MyBooksUserInfo | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showAccessCodeDialog, setShowAccessCodeDialog] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(topBarRef);
  const iconSize18 = useResponsiveSize(18);
  const { safeAreaInsets: insets } = useThemeStore();

  const fetchUserInfo = useCallback(async () => {
    try {
      const info = await getUserInfo();
      if (status === 'logged_in' && info && !info.is_login) {
        logout();
        return;
      }
      setUserInfo(info);
      setIsAdmin(info?.is_admin ?? false);
      const sysInfo = useMyBooksStatusStore.getState().sysInfo;
      if (
        isTauriAppPlatform() &&
        sysInfo?.invited_enabled &&
        !hasTauriMyBooksCookieNamed('invited')
      ) {
        setShowAccessCodeDialog(true);
      }
    } catch (error) {
      // The site requires an access code and the client's `invited` cookie
      // is missing/expired — surface the same dialog LoginDialog shows so
      // the user can re-enter it, instead of silently failing every
      // MyBooks request.
      if (error instanceof MyBooksApiError && error.err === 'not_invited') {
        setShowAccessCodeDialog(true);
      }
    }
  }, [status, setIsAdmin, logout]);

  useEffect(() => {
    if (status === 'logged_in') {
      // Give a remembered access code a chance to silently refresh
      // `mybooks_tauri_cookie` first, so the invited_enabled check above
      // doesn't ask the user something we can already answer ourselves.
      if (host) {
        refreshTauriAccessCodeCookie(host).then(fetchUserInfo);
      } else {
        fetchUserInfo();
      }
    } else {
      setUserInfo(null);
      setIsAdmin(false);
    }
  }, [status, fetchUserInfo, host]);

  const avatarProxyUrl = userInfo?.avatar ? getMyBooksAvatarUrl(userInfo.avatar) : '';

  useShortcuts({
    onToggleSelectMode,
  });

  // Keep the category selector in sync with back/forward navigation.
  useEffect(() => {
    setSearchCategory((searchParams?.get('cat') as SearchCategory) || 'local');
  }, [searchParams]);

  const searchCategoryRef = useRef(searchCategory);
  searchCategoryRef.current = searchCategory;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (value) {
        params.set('q', value);
      } else {
        params.delete('q');
      }
      // Reapply the currently selected category, since selecting a category
      // while the query is empty doesn't touch the URL (see
      // handleSelectCategory) and would otherwise be lost once typing pushes
      // a new `q`-only URL.
      const category = searchCategoryRef.current;
      if (category === 'local') {
        params.delete('source');
        params.delete('type');
        params.delete('cat');
      } else {
        params.set('source', 'cloud');
        params.set('type', 'search');
        params.set('cat', category);
      }
      router.push(`?${params.toString()}`);
    }, 500),
    [searchParams],
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    debouncedUpdateQueryParam(newQuery);
  };

  const handleSelectCategory = (category: SearchCategory) => {
    setSearchCategory(category);
    if (!searchQuery) {
      return;
    }
    const params = new URLSearchParams(searchParams?.toString());
    if (category === 'local') {
      params.delete('source');
      params.delete('type');
      params.delete('cat');
    } else {
      params.set('source', 'cloud');
      params.set('type', 'search');
      params.set('cat', category);
    }
    router.push(`?${params.toString()}`);
  };

  const currentCategoryLabel =
    SEARCH_CATEGORIES.find((cat) => cat.value === searchCategory)?.label ?? 'Current Bookshelf';

  const currentBookshelfTitle = _(
    getBookshelfTitleKey(
      searchParams?.get('source') || 'local',
      searchParams?.get('type') || 'all',
    ),
  );

  const handleCheckMyBooksConnectivity = async () => {
    const { online, needsLogin } = await checkMyBooksConnectivity();
    if (!online) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        timeout: 2000,
        message: _('Still unable to reach MyBooks'),
      });
    } else if (needsLogin) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        timeout: 3000,
        message: _('Please sign in to MyBooks again'),
      });
    } else {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        timeout: 2000,
        message: _('Login'),
      });
    }
  };

  const handleOpenMyBooksSettings = () => {
    setRequestedPanel('Integrations');
    setSettingsDialogOpen(true);
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.reduce(
    (acc, item) => acc + ('books' in item ? item.books.length : 1),
    0,
  );
  const searchPlaceholder =
    searchCategory !== 'local'
      ? _('Search in MyBooks...')
      : currentBooksCount > 1
        ? _('Search in {{count}} Book(s)...', { count: currentBooksCount })
        : _('Search Books...');

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex w-full flex-col py-2 pr-4',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0 sm:pl-2',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div
        ref={topBarRef}
        className='flex h-[52px] w-full items-center justify-between space-x-6 sm:h-[44px] sm:space-x-12'
      >
        <div className='exclude-title-bar-mousedown relative flex w-full items-center pl-2 sm:pl-4'>
          <button
            onClick={onToggleDrawer}
            className='btn btn-ghost p-1 h-9 min-h-9 mr-1 flex items-center justify-center text-base-content/70'
            aria-label={isDrawerOpen ? _('Collapse Sidebar') : _('Expand Sidebar')}
          >
            {isDrawerOpen ? (
              <svg
                width='1.5em'
                height='1.5em'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M22 4a1 1 0 0 0-1-1H3a1 1 0 0 0 0 2h18a1 1 0 0 0 1-1Zm-11.111 7c.614 0 1.111.448 1.111 1s-.498 1-1.111 1H3.11C2.497 13 2 12.552 2 12s.497-1 1.111-1h7.778ZM12 20c0-.552-.498-1-1.111-1H3.11C2.497 19 2 19.448 2 20s.497 1 1.111 1h7.778c.614 0 1.111-.448 1.111-1Zm3.41-3.136a1.117 1.117 0 0 1 0-1.729l4.951-3.917c.675-.534 1.639-.026 1.639.865v7.834c0 .89-.964 1.4-1.639.865l-4.951-3.918Z'
                  fill='currentColor'
                />
              </svg>
            ) : (
              <svg
                width='1.5em'
                height='1.5em'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M22 4a1 1 0 0 0-1-1H3a1 1 0 0 0 0 2h18a1 1 0 0 0 1-1Zm-11.111 7c.614 0 1.111.448 1.111 1s-.498 1-1.111 1H3.11C2.497 13 2 12.552 2 12s.497-1 1.111-1h7.778ZM12 20c0-.552-.498-1-1.111-1H3.11C2.497 19 2 19.448 2 20s.497 1 1.111 1h7.778c.614 0 1.111-.448 1.111-1Zm3.41-3.136a1.117 1.117 0 0 1 0-1.729l4.951-3.917c.675-.534 1.639-.026 1.639.865v7.834c0 .89-.964 1.4-1.639.865l-4.951-3.918Z'
                  fill='currentColor'
                  transform='rotate(180 12 12)'
                />
              </svg>
            )}
          </button>

          {isMobile && !showMobileSearch && (
            <span className='bg-base-300/50 max-w-full truncate rounded-full px-3 py-1 text-sm font-medium'>
              {currentBookshelfTitle}
            </span>
          )}

          {!isMobile && (
            <>
              <div className='relative flex h-9 w-full items-center sm:h-7'>
                <Dropdown
                  label={_('Search Category')}
                  className='exclude-title-bar-mousedown dropdown-bottom cursor-pointer'
                  containerClassName='absolute left-1 top-1 z-10'
                  buttonClassName={clsx(
                    'flex h-7 max-w-[84px] items-center gap-0.5 rounded-full px-2 sm:h-6',
                    'text-base-content/60 hover:bg-base-300/70 text-xs',
                  )}
                  toggleButton={
                    <>
                      <span className='truncate'>{_(currentCategoryLabel)}</span>
                      <MdExpandMore role='none' className='h-3.5 w-3.5 shrink-0' />
                    </>
                  }
                >
                  <SearchCategoryMenu
                    currentCategory={searchCategory}
                    onSelectCategory={handleSelectCategory}
                  />
                </Dropdown>
                <span className='absolute ps-24'>
                  <span className='bg-base-content/30 block h-4 w-[0.5px]' />
                </span>
                <span className='text-base-content/50 absolute ps-28'>
                  <FaSearch className='h-4 w-4' />
                </span>
                <input
                  type='text'
                  value={searchQuery}
                  placeholder={searchPlaceholder}
                  onChange={handleSearchChange}
                  spellCheck='false'
                  className={clsx(
                    'search-input input h-9 w-full rounded-full pr-[30%] ps-36 sm:h-7',
                    'bg-base-300/45 border-0',
                    'font-sans text-sm font-light',
                    'placeholder:text-base-content/50 truncate',
                    'focus:outline-none focus:ring-0',
                  )}
                />
              </div>
              <div className='text-base-content/50 absolute right-4 flex items-center space-x-2 sm:space-x-4'>
                {searchQuery && (
                  <button
                    type='button'
                    onClick={() => {
                      setSearchQuery('');
                      debouncedUpdateQueryParam('');
                    }}
                    className='text-base-content/40 hover:text-base-content/60 pe-1'
                    aria-label={_('Clear Search')}
                  >
                    <IoMdCloseCircle className='h-4 w-4' />
                  </button>
                )}
                <span className='bg-base-content/50 mx-2 h-4 w-[0.5px]'></span>
                {!isCloudLibrary && (
                  <Dropdown
                    label={_('Import Books')}
                    className={clsx(
                      'exclude-title-bar-mousedown dropdown-bottom dropdown-end cursor-pointer',
                    )}
                    buttonClassName='p-0 h-6 min-h-6 w-6 flex touch-target items-center justify-center !bg-transparent'
                    toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
                  >
                    <ImportMenu
                      onImportBooksFromFiles={onImportBooksFromFiles}
                      onImportBooksFromDirectory={onImportBooksFromDirectory}
                      onImportBookFromUrl={onImportBookFromUrl}
                      onOpenCatalogManager={onOpenCatalogManager}
                      onOpenFeeds={onOpenFeeds}
                    />
                  </Dropdown>
                )}
                {isMobile || isCloudLibrary ? null : (
                  <button
                    onClick={onToggleSelectMode}
                    aria-label={_('Select Books')}
                    title={_('Select Books')}
                    className='h-6'
                  >
                    {isSelectMode ? (
                      <PiSelectionAllFill role='button' className='text-base-content/60 h-6 w-6' />
                    ) : (
                      <PiSelectionAll role='button' className='text-base-content/60 h-6 w-6' />
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {isSelectMode ? (
          <div
            className={clsx(
              'flex h-full items-center',
              'w-max-[72px] w-min-[72px] sm:w-max-[80px] sm:w-min-[80px]',
            )}
          >
            <button
              onClick={isSelectAll ? onDeselectAll : onSelectAll}
              className='btn btn-ghost text-base-content/85 h-8 min-h-8 w-[72px] p-0 sm:w-[80px]'
              aria-label={isSelectAll ? _('Deselect') : _('Select All')}
            >
              <span className='font-sans text-base font-normal sm:text-sm whitespace-nowrap truncate'>
                {isSelectAll ? _('Deselect') : _('Select All')}
              </span>
            </button>
          </div>
        ) : (
          <div className='flex h-full items-center gap-x-2 sm:gap-x-4'>
            {isMobile && (
              <button
                onClick={() => setShowMobileSearch((prev) => !prev)}
                aria-label={_('Search Books')}
                title={_('Search Books')}
                aria-pressed={showMobileSearch}
                className={clsx(
                  'btn btn-ghost h-8 min-h-8 w-8 p-0',
                  showMobileSearch && 'bg-base-300/70',
                )}
              >
                <FaSearch role='none' className='text-base-content/60 h-4 w-4' />
              </button>
            )}
            {connectionStatus === 'unreachable' && (
              <button
                onClick={handleCheckMyBooksConnectivity}
                aria-label={_('MyBooks Offline')}
                title={_('MyBooks Offline — tap to retry')}
                className='btn btn-ghost h-8 min-h-8 w-8 p-0'
              >
                <MdOutlineCloudOff role='none' className='text-warning' size={iconSize18} />
              </button>
            )}
            {connectionStatus === 'unconfigured' && (
              <button
                onClick={handleOpenMyBooksSettings}
                aria-label={_('MyBooks Not Configured')}
                title={_('MyBooks server address is not set up — tap to configure')}
                className='btn btn-ghost h-8 min-h-8 w-8 p-0'
              >
                <MdOutlineCloudQueue
                  role='none'
                  className='text-base-content/50'
                  size={iconSize18}
                />
              </button>
            )}
            <Dropdown
              label={_('View Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<PiDotsThreeCircle role='none' size={iconSize18} />}
            >
              <ViewMenu />
            </Dropdown>
            {status === 'logged_out' ? (
              <button
                onClick={openLoginDialog}
                className='btn btn-primary btn-xs h-6 min-h-6 rounded-full px-3 text-xs text-primary-content'
              >
                {_('Login')}
              </button>
            ) : (
              <button
                onClick={() => (isGuest ? openLoginDialog() : setShowUserSettings(true))}
                aria-label={isGuest ? _('Guest') : _('Account')}
                title={
                  isGuest
                    ? _('Guest — tap to sign in')
                    : userInfo?.nickname || userInfo?.username || _('Account')
                }
                className='exclude-title-bar-mousedown flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-base-200 h-7 w-7'
              >
                {!isGuest && avatarProxyUrl ? (
                  <UserAvatar
                    url={avatarProxyUrl}
                    size={20}
                    DefaultIcon={MdPersonOutline}
                    fillContainer
                  />
                ) : isGuest ? (
                  <MdOutlineNoAccounts className='text-base-content/60 h-5 w-5' />
                ) : (
                  <MdPersonOutline className='text-base-content/60 h-5 w-5' />
                )}
              </button>
            )}
            <Dropdown
              label={_('Settings Menu')}
              className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
              toggleButton={<MdOutlineMenu role='none' size={iconSize18} />}
            >
              <SettingsMenu onImportBooksFromDirectory={onImportBooksFromDirectory} />
            </Dropdown>
            {appService?.hasWindowBar && (
              <WindowButtons
                headerRef={headerRef}
                showMinimize={windowButtonVisible}
                showMaximize={windowButtonVisible}
                showClose={windowButtonVisible}
              />
            )}
          </div>
        )}
      </div>
      {isMobile && showMobileSearch && (
        <div className='exclude-title-bar-mousedown relative flex w-full items-center px-2 pb-2 sm:px-4'>
          <div className='relative flex h-9 w-full items-center'>
            <Dropdown
              label={_('Search Category')}
              className='exclude-title-bar-mousedown dropdown-bottom cursor-pointer'
              containerClassName='absolute left-1 top-1 z-10'
              buttonClassName={clsx(
                'flex h-7 max-w-[84px] items-center gap-0.5 rounded-full px-2',
                'text-base-content/60 hover:bg-base-300/70 text-xs',
              )}
              toggleButton={
                <>
                  <span className='truncate'>{_(currentCategoryLabel)}</span>
                  <MdExpandMore role='none' className='h-3.5 w-3.5 shrink-0' />
                </>
              }
            >
              <SearchCategoryMenu
                currentCategory={searchCategory}
                onSelectCategory={handleSelectCategory}
              />
            </Dropdown>
            <span className='absolute ps-24'>
              <span className='bg-base-content/30 block h-4 w-[0.5px]' />
            </span>
            <input
              type='text'
              value={searchQuery}
              placeholder={searchPlaceholder}
              onChange={handleSearchChange}
              spellCheck='false'
              autoFocus
              className={clsx(
                'search-input input h-9 w-full rounded-full pr-[30%] ps-28',
                'bg-base-300/45 border-0',
                'font-sans text-sm font-light',
                'placeholder:text-base-content/50 truncate',
                'focus:outline-none focus:ring-0',
              )}
            />
          </div>
          <div className='text-base-content/50 absolute right-4 flex items-center space-x-2'>
            {searchQuery && (
              <button
                type='button'
                onClick={() => {
                  setSearchQuery('');
                  debouncedUpdateQueryParam('');
                }}
                className='text-base-content/40 hover:text-base-content/60 pe-1'
                aria-label={_('Clear Search')}
              >
                <IoMdCloseCircle className='h-4 w-4' />
              </button>
            )}
            <span className='bg-base-content/50 mx-2 h-4 w-[0.5px]'></span>
            {!isCloudLibrary && (
              <Dropdown
                label={_('Import Books')}
                className='exclude-title-bar-mousedown dropdown-bottom dropdown-end cursor-pointer'
                buttonClassName='p-0 h-6 min-h-6 w-6 flex touch-target items-center justify-center !bg-transparent'
                toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
              >
                <ImportMenu
                  onImportBooksFromFiles={onImportBooksFromFiles}
                  onImportBooksFromDirectory={onImportBooksFromDirectory}
                  onImportBookFromUrl={onImportBookFromUrl}
                  onOpenCatalogManager={onOpenCatalogManager}
                  onOpenFeeds={onOpenFeeds}
                />
              </Dropdown>
            )}
          </div>
        </div>
      )}
      <UserSettingsDialog isOpen={showUserSettings} onClose={() => setShowUserSettings(false)} />
      {showAccessCodeDialog && host && (
        <AccessCodeDialog
          host={host}
          onClose={() => setShowAccessCodeDialog(false)}
          onSuccess={() => {
            setShowAccessCodeDialog(false);
            fetchUserInfo();
          }}
        />
      )}
    </div>
  );
};

export default LibraryHeader;
