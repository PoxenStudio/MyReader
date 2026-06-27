import React, { useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useMyBooksConnectionStatus } from '@/store/mybooksStatusStore';
import UserSettingsDialog from '@/components/user/UserSettingsDialog';
import DeviceManagementDialog from '@/components/user/DeviceManagementDialog';

// Icons
import {
  MdHome,
  MdPeople,
  MdSettings,
  MdShield,
  MdPhoneAndroid,
  MdBook,
  MdFavorite,
  MdBookmarkAdd,
  MdAutoStories,
  MdCheckCircle,
  MdHistory,
  MdCategory,
  MdWidgets,
  MdLocalOffer,
  MdBusiness,
  MdCollectionsBookmark,
  MdTranslate,
  MdChecklist,
  MdStar,
  MdKeyboardArrowDown,
  MdKeyboardArrowRight,
} from 'react-icons/md';

interface NavSubItem {
  icon: React.ReactNode;
  text: string;
  color: string;
  href?: string;
  onClick?: () => void;
  source?: string;
  type?: string;
}

interface NavGroupItem {
  key: string;
  icon: React.ReactNode;
  text: string;
  color: string;
  expand?: boolean;
  groups: NavSubItem[];
}

interface LibraryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: () => void;
  className?: string;
}

const LibraryDrawer: React.FC<LibraryDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
  className,
}) => {
  const _ = useTranslation();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { status } = useAuth();
  const connectionStatus = useMyBooksConnectionStatus();
  const { safeAreaInsets: insets, systemUIVisible, statusBarHeight } = useThemeStore();

  const [showUserSettings, setShowUserSettings] = useState(false);
  const [showDeviceManagement, setShowDeviceManagement] = useState(false);

  // The cloud bookshelf needs both an account (logged in or guest) and a
  // reachable MyBooks server — without either, MyReader is just a local
  // reader and these sections are shown but disabled rather than hidden.
  const isCloudAvailable = status !== 'logged_out' && connectionStatus === 'connected';

  // Track expanded state for accordion groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean | undefined>>({});

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: prev[groupKey] === undefined ? true : !prev[groupKey],
    }));
  };

  // Get current source and type from search params
  const currentSource = searchParams?.get('source') || 'local';
  const currentType = searchParams?.get('type') || 'all';

  // The root path renders the library page directly (see src/app/page.tsx),
  // so '/' and '/library' are both valid library routes.
  const isLibraryPath = pathname === '/library' || pathname === '/';

  // Check if the link matches current state
  const isLinkActive = (source: string, type?: string) => {
    if (!isLibraryPath) return false;
    if (currentSource !== source) return false;
    if (type && currentType !== type) return false;
    return true;
  };

  // Check if any cloud type is active (for expanding groups)
  const isCloudTypeActive = (types: string[]) => {
    if (!isLibraryPath) return false;
    if (currentSource !== 'cloud') return false;
    return types.includes(currentType);
  };

  // Menu Definitions
  const home_links = [
    {
      icon: <MdHome className='w-5 h-5' />,
      href: '/library?source=local',
      text: _('Home'),
      color: 'text-primary',
      source: 'local',
    },
  ];
  const user_links = [
    {
      key: 'user_center',
      icon: <MdPeople className='w-5 h-5' />,
      text: _('Personal Settings'),
      color: 'text-primary',
      expand: pathname?.startsWith('/user/'),
      groups: [
        {
          icon: <MdSettings className='w-5 h-5' />,
          onClick: () => setShowUserSettings(true),
          text: _('User Settings'),
          color: 'text-primary',
        },
        {
          icon: <MdShield className='w-5 h-5' />,
          href: '/library?source=cloud&type=soledbooks',
          text: _('Private Books'),
          color: 'text-yellow-500',
        },
        {
          icon: <MdPhoneAndroid className='w-5 h-5' />,
          onClick: () => setShowDeviceManagement(true),
          text: _('My Devices'),
          color: 'text-primary',
        },
      ],
    },
  ];

  const reading_links = [
    {
      key: 'reading_info',
      icon: <MdBook className='w-5 h-5' />,
      text: _('Reading Information'),
      expand:
        isCloudTypeActive(['favorites', 'wants', 'reading', 'read-done', 'soledbooks']) ||
        pathname?.startsWith('/user/'),
      color: 'text-primary',
      groups: [
        {
          icon: <MdFavorite className='w-5 h-5' />,
          href: '/library?source=cloud&type=favorites',
          text: _('My Favorites'),
          color: 'text-red-500',
          source: 'cloud',
          type: 'favorites',
        },
        {
          icon: <MdBookmarkAdd className='w-5 h-5' />,
          href: '/library?source=cloud&type=wants',
          text: _('Want to Read'),
          color: 'text-orange-500',
          source: 'cloud',
          type: 'wants',
        },
        {
          icon: <MdAutoStories className='w-5 h-5' />,
          href: '/library?source=cloud&type=reading',
          text: _('Reading'),
          color: 'text-blue-500',
          source: 'cloud',
          type: 'reading',
        },
        {
          icon: <MdCheckCircle className='w-5 h-5' />,
          href: '/library?source=cloud&type=read-done',
          text: _('Read'),
          color: 'text-green-500',
          source: 'cloud',
          type: 'read-done',
        },
      ],
    },
  ];

  const nav_links = [
    {
      icon: <MdCategory className='w-5 h-5' />,
      href: '/library?source=cloud&type=categories',
      text: _('Categories'),
      color: 'text-green-500',
      source: 'cloud',
      type: 'categories',
    },
    {
      icon: <MdPeople className='w-5 h-5' />,
      href: '/library?source=cloud&type=author',
      text: _('Authors'),
      color: 'text-primary',
      source: 'cloud',
      type: 'author',
    },
    {
      icon: <MdLocalOffer className='w-5 h-5' />,
      href: '/library?source=cloud&type=tag',
      text: _('Tags'),
      color: 'text-green-500',
      source: 'cloud',
      type: 'tag',
    },
    {
      icon: <MdBusiness className='w-5 h-5' />,
      href: '/library?source=cloud&type=publisher',
      text: _('Publishers'),
      color: 'text-primary',
      source: 'cloud',
      type: 'publisher',
    },
    {
      icon: <MdCollectionsBookmark className='w-5 h-5' />,
      href: '/library?source=cloud&type=series',
      text: _('Series'),
      color: 'text-primary',
      source: 'cloud',
      type: 'series',
    },
    {
      icon: <MdTranslate className='w-5 h-5' />,
      href: '/library?source=cloud&type=language',
      text: _('Languages'),
      color: 'text-purple-500',
      source: 'cloud',
      type: 'language',
    },
    {
      icon: <MdChecklist className='w-5 h-5' />,
      href: '/library?source=cloud&type=all',
      text: _('All Books'),
      color: 'text-primary',
      source: 'cloud',
      type: 'all',
    },
    {
      icon: <MdStar className='w-5 h-5' />,
      href: '/library?source=cloud&type=rating',
      text: _('Rating'),
      color: 'text-orange-500',
      source: 'cloud',
      type: 'rating',
    },
  ];

  // Helper to handle navigation click for library links
  const handleLibraryClick = (href: string) => {
    if (href.startsWith('/library')) {
      onNavigate?.();
    }
    if (appService?.isMobile) onClose();
  };

  // Helper to render groups (2-level menus). When `disabled`, the group
  // can't be expanded/navigated — used for cloud-only sections when there's
  // no account or no reachable MyBooks server (see `isCloudAvailable`).
  const renderNavGroup = (groupItem: NavGroupItem, disabled = false) => {
    const isExpanded =
      !disabled &&
      (expandedGroups[groupItem.key] !== undefined
        ? expandedGroups[groupItem.key]
        : groupItem.expand);

    return (
      <li key={groupItem.key} className='flex flex-col w-full'>
        <button
          onClick={() => !disabled && toggleGroup(groupItem.key)}
          disabled={disabled}
          aria-disabled={disabled}
          className={clsx(
            'flex items-center justify-between w-full p-2 rounded-md transition-colors',
            disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-base-200',
          )}
        >
          <div className='flex items-center gap-3'>
            <span className={groupItem.color}>{groupItem.icon}</span>
            <span className='font-medium text-sm'>{groupItem.text}</span>
          </div>
          {isExpanded ? (
            <MdKeyboardArrowDown className='w-4 h-4 opacity-70' />
          ) : (
            <MdKeyboardArrowRight className='w-4 h-4 opacity-70' />
          )}
        </button>

        {isExpanded && (
          <ul className='pl-6 pr-2 mt-1 space-y-1 w-full'>
            {groupItem.groups.map((subItem: NavSubItem, idx: number) => {
              const itemClassName = clsx(
                'flex items-center gap-3 p-2 rounded-md transition-colors text-sm w-full',
                'hover:bg-base-200 text-base-content/80 hover:text-base-content',
              );
              return (
                <li key={idx}>
                  {subItem.onClick ? (
                    <button type='button' className={itemClassName} onClick={subItem.onClick}>
                      <span className={subItem.color}>{subItem.icon}</span>
                      <span>{subItem.text}</span>
                    </button>
                  ) : (
                    <Link
                      href={subItem.href ?? ''}
                      className={clsx(
                        itemClassName,
                        (subItem.source
                          ? isLinkActive(subItem.source, subItem.type)
                          : pathname === subItem.href) && 'bg-primary/10 !text-primary font-medium',
                      )}
                      onClick={() => handleLibraryClick(subItem.href ?? '')}
                    >
                      <span className={subItem.color}>{subItem.icon}</span>
                      <span>{subItem.text}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  // Helper to render 1-level links. `disabled` renders a non-interactive
  // span instead of a Link so cloud sections can't be navigated into.
  const renderNavLink = (link: any, idx: number, disabled = false) => {
    // Check if this is a cloud/local link with source/type
    const isActive = link.source ? isLinkActive(link.source, link.type) : pathname === link.href;
    const content = (
      <>
        <div className='flex items-center gap-3'>
          <span className={link.color}>{link.icon}</span>
          <span>{link.text}</span>
        </div>
        {link.count !== undefined && (
          <span className='text-xs bg-base-300 px-2 py-0.5 rounded-full'>{link.count}</span>
        )}
      </>
    );
    if (disabled) {
      return (
        <li key={idx} className='w-full'>
          <span
            aria-disabled
            className='flex items-center justify-between p-2 rounded-md text-sm w-full opacity-40 cursor-not-allowed'
          >
            {content}
          </span>
        </li>
      );
    }
    return (
      <li key={idx} className='w-full'>
        <Link
          href={link.href}
          className={clsx(
            'flex items-center justify-between p-2 rounded-md transition-colors text-sm w-full',
            isActive
              ? 'bg-primary/10 text-primary font-medium'
              : 'hover:bg-base-200 text-base-content/80 hover:text-base-content',
          )}
          onClick={() => handleLibraryClick(link.href)}
        >
          {content}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className='fixed inset-0 bg-black/40 z-40 lg:hidden transition-opacity'
          onClick={onClose}
        />
      )}

      {/* Drawer Container */}
      <div
        className={clsx(
          'fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-base-100 border-r border-base-300 w-64 transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          className,
        )}
        style={{
          paddingTop: appService?.hasSafeAreaInset
            ? `max(${insets?.top || 0}px, ${systemUIVisible ? statusBarHeight : 0}px)`
            : '0px',
        }}
      >
        <div className='flex-1 overflow-y-auto overflow-x-hidden p-3 custom-scrollbar'>
          <ul className='space-y-1'>
            <li className='h-10'></li>
            {/* Home Links Section */}
            <div className='space-y-1'>
              {home_links.map((link, idx) => renderNavLink(link, idx))}
            </div>
            {/* User Links Section */}
            <div className='space-y-1'>
              {user_links.map((group) => renderNavGroup(group, !isCloudAvailable))}
            </div>

            <div className='h-px bg-base-300 w-full my-2'></div>

            {/* Reading Links Section */}
            <div className='space-y-1'>
              {reading_links.map((group) => renderNavGroup(group, !isCloudAvailable))}
            </div>

            <div className='h-px bg-base-300 w-full my-2'></div>

            {/* Navigation Links Section */}
            <div className='space-y-1 pb-4'>
              {nav_links.map((link, idx) => renderNavLink(link, idx, !isCloudAvailable))}
            </div>
          </ul>
        </div>
      </div>
      <UserSettingsDialog isOpen={showUserSettings} onClose={() => setShowUserSettings(false)} />
      <DeviceManagementDialog
        isOpen={showDeviceManagement}
        onClose={() => setShowDeviceManagement(false)}
      />
    </>
  );
};

export default LibraryDrawer;
