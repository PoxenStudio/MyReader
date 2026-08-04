'use client';

import { useEffect, useRef } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import {
  NasCookieEntry,
  createNasLoginWindow,
  getWebviewCookies,
  attachNasCloseButton,
  detachNasCloseButton,
} from '@/utils/bridge';

const MAX_WIDTH = 800;
const MAX_HEIGHT = 1024;

/**
 * NAS portals are ordinary consumer web apps that branch on UA the same way
 * any mobile-first site does — match the app's own platform so the NAS login
 * page renders its mobile layout on phones instead of a desktop one squeezed
 * into an 800px popup. Always a standard Chrome UA (never the popup's real
 * engine default — WKWebView's Safari UA on macOS, WebView2's on Windows —
 * since some NAS vendor portals branch on browser vendor and don't expect
 * those).
 */
const getUserAgentForPlatform = (): string => {
  const platform = osType();
  if (platform === 'android') {
    return 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
  }
  if (platform === 'ios') {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  }
  if (platform === 'macos') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }
  if (platform === 'linux') {
    return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

interface NasRemoteWebviewProps {
  /** NAS device portal URL to open. */
  url: string;
  /**
   * Called once the popup is closed (by the user or on unmount), with the
   * cookies captured for `url` (each tagged with its domain scope — see
   * `NasCookieEntry`), or `null` if none could be read.
   */
  onClose: (cookies: NasCookieEntry[] | null) => void;
}

const NasRemoteWebview: React.FC<NasRemoteWebviewProps> = ({ url, onClose }) => {
  const windowRef = useRef<WebviewWindow | null>(null);
  const closedRef = useRef(false);
  // Android has no OS-level title bar/close button on the popup (mobile
  // `WebviewWindow`s are always fullscreen with no decorations), so a native
  // floating close button is attached instead — see attachNasCloseButton.
  // This listens for its click, forwarded as a plugin event since there's no
  // native window handle to call back into from the native-bridge side.
  const closeListenerRef = useRef<PluginListener | null>(null);

  const captureAndClose = async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    const win = windowRef.current;
    windowRef.current = null;
    const closeListener = closeListenerRef.current;
    closeListenerRef.current = null;
    let cookies: NasCookieEntry[] | null = null;
    if (win) {
      try {
        const result = await getWebviewCookies({ label: win.label, url });
        cookies = result.cookies.length ? result.cookies : null;
      } catch (e) {
        console.error('Failed to read NAS window cookies:', e);
      }
      if (osType() === 'android') {
        try {
          await detachNasCloseButton();
        } catch (e) {
          console.error('Failed to detach NAS close button:', e);
        }
      }
      try {
        // destroy(), not close() — close() re-emits closeRequested (which
        // we already handle below), destroy() forces it without looping.
        await win.destroy();
      } catch (e) {
        console.error('Failed to close NAS window:', e);
      }
    }
    if (closeListener) {
      try {
        await closeListener.unregister();
      } catch (e) {
        console.error('Failed to unregister NAS close button listener:', e);
      }
    }
    onClose(cookies);
  };

  useEffect(() => {
    let cancelled = false;
    closedRef.current = false;

    const create = async () => {
      const parent = getCurrentWindow();
      const innerSize = await parent.innerSize();
      const scaleFactor = await parent.scaleFactor();
      const logicalWidth = innerSize.width / scaleFactor;
      const logicalHeight = innerSize.height / scaleFactor;
      const width = Math.min(MAX_WIDTH, logicalWidth);
      const height = Math.min(MAX_HEIGHT, logicalHeight);

      if (cancelled) return;
      const label = `nas-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        // Goes through our own `create_nas_login_window` command (not the
        // plain JS `new WebviewWindow(...)`) so the popup's title bar can
        // show a "(Loading...)" animation while the (externally hosted) NAS
        // page loads — driven by the Rust-side `on_page_load` hook, which
        // has no JS-side equivalent.
        await createNasLoginWindow({
          label,
          url,
          title: hostOf(url),
          width,
          height,
          userAgent: getUserAgentForPlatform(),
        });
      } catch (e) {
        console.error('Failed to create NAS window:', e);
        return;
      }
      if (cancelled) {
        // Unmounted while the window was being created — nothing else will
        // ever reference this label, so close it now instead of leaving an
        // orphaned popup.
        WebviewWindow.getByLabel(label).then((w) => w?.destroy());
        return;
      }
      const win = await WebviewWindow.getByLabel(label);
      if (!win) {
        console.error('NAS window not found right after creation');
        return;
      }
      windowRef.current = win;
      await win.onCloseRequested(async (event) => {
        // Intercept the native close button too, so we still capture
        // cookies before the window actually goes away.
        event.preventDefault();
        await captureAndClose();
      });

      if (osType() === 'android') {
        try {
          // Register the listener before attaching the button so a click
          // can never race ahead of us being ready to hear it.
          closeListenerRef.current = await addPluginListener(
            'native-bridge',
            'nasLoginClose',
            (event: { label: string }) => {
              if (event.label === label) captureAndClose();
            },
          );
          await attachNasCloseButton({ label });
        } catch (e) {
          console.error('Failed to attach NAS close button:', e);
        }
      }
    };

    create();

    return () => {
      cancelled = true;
      // Only tear down if this invocation actually produced a window.
      // React's dev-mode StrictMode double-invokes effects (mount → cleanup
      // → mount again) on first mount — the cleanup for that first,
      // throwaway invocation fires before `create()`'s awaited IPC calls
      // resolve, so `windowRef.current` is still null here. Calling
      // `captureAndClose()` (and hence `onClose(null)`) unconditionally in
      // that case fires the "closed" callback for a window that was never
      // shown, which made the *real* (second) invocation's popup — created
      // moments later — get torn down almost immediately by the parent
      // reacting to that spurious close, sometimes before the native window
      // had even finished registering (surfacing as "no webview with label
      // ...' when we then tried to read its cookies).
      if (windowRef.current) {
        captureAndClose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return null;
};

export default NasRemoteWebview;
