'use client';

import { useEffect, useRef, useState } from 'react';
import { MdClose, MdRefresh } from 'react-icons/md';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { type as osType } from '@tauri-apps/plugin-os';
import { useTranslation } from '@/hooks/useTranslation';
import { getWebviewCookies } from '@/utils/bridge';

const MAX_WIDTH = 800;
const MAX_HEIGHT = 1024;
const TOOLBAR_HEIGHT = 40;

/**
 * NAS portals are ordinary consumer web apps that branch on UA the same way
 * any mobile-first site does — match the app's own platform so the NAS login
 * page renders its mobile layout on phones instead of a desktop one squeezed
 * into an 800px popup.
 */
const getUserAgentForPlatform = (): string | undefined => {
  const platform = osType();
  if (platform === 'android') {
    return 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
  }
  if (platform === 'ios') {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  }
  return undefined;
};

interface NasRemoteWebviewProps {
  /** NAS device portal URL to open. */
  url: string;
  /**
   * Called once the webview is closed (by the user or on unmount), with the
   * `Cookie` header captured for `url`, or `null` if none could be read.
   */
  onClose: (cookieHeader: string | null) => void;
}

/**
 * Full-screen overlay hosting an embedded (in-window) child Tauri webview
 * for NAS device login. Not an OS-level window — sized/positioned within
 * the current app window so it behaves the same on desktop and mobile, and
 * clamped to `MAX_WIDTH`x`MAX_HEIGHT` (or the window size, if smaller).
 *
 * Closing (via the toolbar button or unmount) reads back the cookies set
 * for `url` via the `get_webview_cookies` native-bridge command before
 * tearing the child webview down.
 */
const NasRemoteWebview: React.FC<NasRemoteWebviewProps> = ({ url, onClose }) => {
  const _ = useTranslation();
  const webviewRef = useRef<Webview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const closedRef = useRef(false);

  const captureAndClose = async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    const webview = webviewRef.current;
    webviewRef.current = null;
    let cookieHeader: string | null = null;
    if (webview) {
      try {
        const result = await getWebviewCookies({ label: webview.label, url });
        cookieHeader = result.cookieHeader || null;
      } catch (e) {
        console.error('Failed to read NAS webview cookies:', e);
      }
      try {
        await webview.close();
      } catch (e) {
        console.error('Failed to close NAS webview:', e);
      }
    }
    onClose(cookieHeader);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const create = async () => {
      const parent = getCurrentWindow();
      const innerSize = await parent.innerSize();
      const scaleFactor = await parent.scaleFactor();
      const logicalWidth = innerSize.width / scaleFactor;
      const logicalHeight = innerSize.height / scaleFactor;
      const availableHeight = Math.max(0, logicalHeight - TOOLBAR_HEIGHT);
      const width = Math.min(MAX_WIDTH, logicalWidth);
      const height = Math.min(MAX_HEIGHT, availableHeight);
      const x = Math.max(0, (logicalWidth - width) / 2);
      const y = TOOLBAR_HEIGHT + Math.max(0, (availableHeight - height) / 2);

      if (cancelled) return;
      const label = `nas-login-${Date.now()}`;
      const webview = new Webview(parent, label, {
        url,
        x,
        y,
        width,
        height,
        userAgent: getUserAgentForPlatform(),
      });
      webview.once('tauri://created', () => {
        if (!cancelled) setLoading(false);
      });
      webview.once('tauri://error', (e) => {
        console.error('Failed to create NAS webview:', e);
        if (!cancelled) setLoading(false);
      });
      webviewRef.current = webview;
    };

    create();

    return () => {
      cancelled = true;
      if (!closedRef.current) {
        captureAndClose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reloadNonce]);

  const handleRefresh = async () => {
    const webview = webviewRef.current;
    webviewRef.current = null;
    if (webview) {
      try {
        await webview.close();
      } catch (e) {
        console.error('Failed to close NAS webview before refresh:', e);
      }
    }
    setReloadNonce((n) => n + 1);
  };

  return (
    <div className='fixed inset-0 z-[100] flex flex-col bg-black/50'>
      <div
        className='bg-base-100 border-base-300 flex items-center justify-between border-b px-3'
        style={{ height: TOOLBAR_HEIGHT }}
      >
        <span className='text-base-content/70 truncate text-sm'>{url}</span>
        <div className='flex flex-shrink-0 items-center gap-1'>
          {loading && <span className='loading loading-spinner loading-xs' />}
          <button
            type='button'
            onClick={handleRefresh}
            className='btn btn-ghost btn-xs'
            title={_('Refresh')}
            aria-label={_('Refresh')}
          >
            <MdRefresh className='h-4 w-4' />
          </button>
          <button
            type='button'
            onClick={captureAndClose}
            className='btn btn-ghost btn-xs'
            title={_('Close')}
            aria-label={_('Close')}
          >
            <MdClose className='h-4 w-4' />
          </button>
        </div>
      </div>
      <div className='flex-1' />
    </div>
  );
};

export default NasRemoteWebview;
