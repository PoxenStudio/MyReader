import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';

/**
 * Hydrate the custom-font store from persisted `settings.customFonts`.
 *
 * Mount this on the library page so the Font panel always sees imported
 * fonts even when opened straight from the library without a book open.
 */
export const useCustomFonts = () => {
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { loadCustomFonts } = useCustomFontStore();

  useEffect(() => {
    if (!appService) return;
    if (!settings?.customFonts) return;
    void loadCustomFonts(envConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, settings?.customFonts, envConfig]);
};
