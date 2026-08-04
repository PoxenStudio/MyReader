'use client';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useNasDeviceStore } from '@/store/nasDeviceStore';
import { setNasCookies } from '@/services/mybooks/nasCookieStore';
import { NasCookieEntry } from '@/utils/bridge';
import NasRemoteWebview from './NasRemoteWebview';

/**
 * Root-mounted (see Providers.tsx): renders the NAS re-login webview when
 * `fetchMyBooks` detects an expired NAS session and calls
 * `useNasDeviceStore.getState().requestPrompt()` (see `nasSession.ts` /
 * `mybooksService.ts`). Captures cookies + `lastLoginAt` the same way the
 * LoginDialog / UserSettingsDialog manual triggers do.
 */
const NasSessionPrompt: React.FC = () => {
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const promptOpen = useNasDeviceStore((s) => s.promptOpen);
  const closePrompt = useNasDeviceStore((s) => s.closePrompt);
  const nasSettings = settings.nas;

  // Mobile has no supported entry point to enable this (see IntegrationsPanel/
  // LoginDialog/UserSettingsDialog), but `nasSettings.enabled` can still be
  // `true` here if it was turned on from a synced desktop session — guard
  // explicitly so the auto re-login prompt can't fire on Android/iOS.
  if (appService?.isMobileApp) return null;
  if (!promptOpen || !nasSettings?.enabled || !nasSettings.loginUrl) return null;

  const handleClose = async (cookies: NasCookieEntry[] | null) => {
    closePrompt();
    if (!cookies) return;
    try {
      setNasCookies(new URL(nasSettings.loginUrl).host, cookies);
    } catch (e) {
      console.error('Invalid NAS login URL:', e);
      return;
    }
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, nas: { ...latest.nas, lastLoginAt: Date.now() } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  return <NasRemoteWebview url={nasSettings.loginUrl} onClose={handleClose} />;
};

export default NasSessionPrompt;
