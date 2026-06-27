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
import { useMyBooksConnectionStatus } from '@/store/mybooksStatusStore';
import { useAuth } from '@/context/AuthContext';
import { useAuthUIStore } from '@/store/authUIStore';
import {
  checkMyBooksConnectivity,
  getUserInfo,
  getMyBooksAvatarUrl,
  type MyBooksUserInfo,
} from '@/services/mybooksService';
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
import { SEARCH_CATEGORIES, SearchCategory } from '@/app/library/utils/libraryUtils';

interface LibraryHeaderProps {
  isSelectMode: boolean;
  isSelectAll: boolean;
  isCloudLibrary: boolean;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onOpenCatalogManager: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleDrawer: () => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSelectMode,
  isSelectAll,
  isCloudLibrary,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onOpenCatalogManager,
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
  const { status, isGuest, setIsAdmin } = useAuth();
  const openLoginDialog = useAuthUIStore((state) => state.openLoginDialog);
  const { setSettingsDialogOpen, setRequestedPanel } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('q') ?? '');
  const [searchCategory, setSearchCategory] = useState<SearchCategory>(
    () => (searchParams?.get('cat') as SearchCategory) || 'local',
  );
  const [userInfo, setUserInfo] = useState<MyBooksUserInfo | null>(null);
  const [showUserSettings, setShowUserSettings] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);
  const { safeAreaInsets: insets } = useThemeStore();

  useEffect(() => {
    if (status === 'logged_in') {
      getUserInfo()
        .then((info) => {
          setUserInfo(info);
          setIsAdmin(info?.is_admin ?? false);
        })
        .catch(() => {});
    } else {
      setUserInfo(null);
      setIsAdmin(false);
    }
  }, [status]);

  const avatarProxyUrl = userInfo?.avatar ? getMyBooksAvatarUrl(userInfo.avatar) : '';

  useShortcuts({
    onToggleSelectMode,
  });

  // Keep the category selector in sync with back/forward navigation.
  useEffect(() => {
    setSearchCategory((searchParams?.get('cat') as SearchCategory) || 'local');
  }, [searchParams]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateQueryParam = useCallback(
    debounce((value: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (value) {
        params.set('q', value);
      } else {
        params.delete('q');
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

  if (!insets) return null;

  const isMobile = appService?.isMobile || window.innerWidth <= 640;

  return (
    <div
      ref={headerRef}
      className={clsx(
        'titlebar z-10 flex h-[52px] w-full items-center py-2 pr-4 sm:h-[44px]',
        windowButtonVisible ? 'sm:pr-4' : 'sm:pr-6',
        isTrafficLightVisible ? 'pl-16' : 'pl-0 sm:pl-2',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div className='flex w-full items-center justify-between space-x-6 sm:space-x-12'>
        <div className='exclude-title-bar-mousedown relative flex w-full items-center pl-2 sm:pl-4'>
          <button
            onClick={onToggleDrawer}
            className='btn btn-ghost p-1 h-9 min-h-9 mr-1 lg:hidden flex items-center justify-center text-base-content/70'
            aria-label={_('Toggle Menu')}
          >
            <MdOutlineMenu className='w-6 h-6' />
          </button>

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
              placeholder={
                currentBooksCount > 1
                  ? _('Search in {{count}} Book(s)...', {
                      count: currentBooksCount,
                    })
                  : _('Search Books...')
              }
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
                  'exclude-title-bar-mousedown dropdown-bottom dropdown-center cursor-pointer',
                )}
                buttonClassName='p-0 h-6 min-h-6 w-6 flex touch-target items-center justify-center !bg-transparent'
                toggleButton={<PiPlus role='none' className='m-0.5 h-5 w-5' />}
              >
                <ImportMenu
                  onImportBooksFromFiles={onImportBooksFromFiles}
                  onImportBooksFromDirectory={onImportBooksFromDirectory}
                  onImportBookFromUrl={onImportBookFromUrl}
                  onOpenCatalogManager={onOpenCatalogManager}
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
                className='flex-shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-base-200 h-7 w-7'
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
              <SettingsMenu />
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
      <UserSettingsDialog isOpen={showUserSettings} onClose={() => setShowUserSettings(false)} />
    </div>
  );
};

export default LibraryHeader;
