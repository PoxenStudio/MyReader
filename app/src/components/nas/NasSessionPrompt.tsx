'use client';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useNasDeviceStore } from '@/store/nasDeviceStore';
import { setNasCookies } from '@/services/mybooks/nasCookieStore';
import NasRemoteWebview from './NasRemoteWebview';

/**
 * Root-mounted (see Providers.tsx): renders the NAS re-login webview when
 * `fetchMyBooks` detects an expired NAS session and calls
 * `useNasDeviceStore.getState().requestPrompt()` (see `nasSession.ts` /
 * `mybooksService.ts`). Captures cookies + `lastLoginAt` the same way the
 * LoginDialog / UserSettingsDialog manual triggers do.
 */
const NasSessionPrompt: React.FC = () => {
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const promptOpen = useNasDeviceStore((s) => s.promptOpen);
  const closePrompt = useNasDeviceStore((s) => s.closePrompt);
  const nasSettings = settings.nas;

  if (!promptOpen || !nasSettings?.enabled || !nasSettings.loginUrl) return null;

  const handleClose = async (cookieHeader: string | null) => {
    closePrompt();
    if (!cookieHeader) return;
    try {
      setNasCookies(new URL(nasSettings.loginUrl).host, cookieHeader);
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
