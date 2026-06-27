import { redirect, useRouter } from 'next/navigation';
import { getCurrentWindow, ScrollBarStyle } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isPWA, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { AppService } from '@/types/system';
import { useAuthUIStore } from '@/store/authUIStore';

let readerWindowsCount = 0;
const createReaderWindow = (appService: AppService, url: string) => {
  const currentWindow = getCurrentWindow();
  const label = currentWindow.label;
  const newLabelPrefix = label === 'main' ? 'reader' : label;
  const win = new WebviewWindow(`${newLabelPrefix}-${readerWindowsCount}`, {
    url,
    width: 800,
    height: 600,
    center: true,
    resizable: true,
    title: appService.isMacOSApp ? '' : 'MyReader',
    decorations: !!appService.isMacOSApp,
    transparent: !appService.isMacOSApp,
    shadow: appService.isMacOSApp ? undefined : true,
    titleBarStyle: appService.isMacOSApp ? 'overlay' : undefined,
    // Enum ScrollBarStyle is exported as type by tauri, so it cannot be used directly.
    scrollBarStyle: (appService.osPlatform === 'windows'
      ? 'fluentOverlay'
      : 'default') as unknown as ScrollBarStyle,
  });
  win.once('tauri://created', () => {
    console.log('new window created');
    readerWindowsCount += 1;
  });
  win.once('tauri://error', (e) => {
    console.error('error creating window', e);
  });
  win.once('tauri://destroyed', () => {
    readerWindowsCount -= 1;
  });
};

export const showReaderWindow = (appService: AppService, bookIds: string[]) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  const params = new URLSearchParams('');
  params.set('ids', ids);
  const url = `/reader?${params.toString()}`;
  createReaderWindow(appService, url);
};

export const showLibraryWindow = (appService: AppService, filenames: string[]) => {
  const params = new URLSearchParams();
  filenames.forEach((filename) => params.append('file', filename));
  const url = `/library?${params.toString()}`;
  createReaderWindow(appService, url);
};

// Bring the main library window back when a reader window asks to "go to library".
// If main was hidden (macOS close-to-hide) we re-show it. If it was destroyed
// (Windows/Linux default close), we recreate a window with the same 'main'
// label so the existing emitTo('main', 'close-reader-window', ...) wiring
// continues to work.
export const ensureMainLibraryWindow = async (appService: AppService) => {
  const existing = await WebviewWindow.getByLabel('main');
  if (existing) {
    await existing.show();
    await existing.unminimize();
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow('main', {
    url: '/library',
    width: 800,
    height: 600,
    center: true,
    resizable: true,
    title: appService.isMacOSApp ? '' : 'MyReader',
    decorations: !!appService.isMacOSApp,
    transparent: !appService.isMacOSApp,
    shadow: appService.isMacOSApp ? undefined : true,
    titleBarStyle: appService.isMacOSApp ? 'overlay' : undefined,
    scrollBarStyle: (appService.osPlatform === 'windows'
      ? 'fluentOverlay'
      : 'default') as unknown as ScrollBarStyle,
  });
  win.once('tauri://error', (e) => {
    console.error('error recreating main window', e);
  });
};

export const navigateToReader = (
  router: ReturnType<typeof useRouter>,
  bookIds: string[],
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  if (isWebAppPlatform() && !isPWA()) {
    router.push(`/reader/${ids}${queryParams ? `?${queryParams}` : ''}`, navOptions);
  } else {
    const params = new URLSearchParams(queryParams || '');
    params.set('ids', ids);
    router.push(`/reader?${params.toString()}`, navOptions);
  }
};

// Login is now a dialog opened in-place rather than a route navigation —
// the `router` param is kept (unused) so existing call sites don't need to
// change their call signature.
export const navigateToLogin = (_router?: ReturnType<typeof useRouter>) => {
  useAuthUIStore.getState().openLoginDialog();
};

export const navigateToLibrary = (
  router: ReturnType<typeof useRouter>,
  queryParams?: string,
  navOptions?: { scroll?: boolean },
  navBack?: boolean,
) => {
  const lastLibraryParams =
    typeof window !== 'undefined' ? sessionStorage.getItem('lastLibraryParams') : null;
  if (navBack && lastLibraryParams) {
    queryParams = lastLibraryParams;
  }

  router.replace(`/library${queryParams ? `?${queryParams}` : ''}`, navOptions);
};

// Recovery action when a reader has nothing to display — e.g. all books were
// closed, or a book failed to load in a freshly-opened reader window.
// In a dedicated reader window we close the window itself, ensuring the main
// library window is visible first; routing the reader window to /library
// instead would leave a leftover window the user has to close manually.
// In the main window or on web, fall back to /library navigation.
export const closeReaderWindowOrGoToLibrary = async (
  appService: AppService | null,
  router: ReturnType<typeof useRouter>,
) => {
  if (isTauriAppPlatform() && appService?.hasWindow) {
    const currentWindow = getCurrentWindow();
    if (currentWindow.label !== 'main') {
      await ensureMainLibraryWindow(appService);
      await currentWindow.close();
      return;
    }
  }
  navigateToLibrary(router, '', undefined, true);
};

export const redirectToLibrary = () => {
  redirect('/library');
};
