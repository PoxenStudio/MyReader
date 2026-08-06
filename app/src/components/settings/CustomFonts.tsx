import clsx from 'clsx';
import React, { useState } from 'react';
import { MdAdd, MdDelete, MdDownload } from 'react-icons/md';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useFileSelector } from '@/hooks/useFileSelector';
import { saveViewSettings } from '@/helpers/settings';
import { CustomFont, mountCustomFont } from '@/styles/fonts';
import { PRESET_CJK_FONTS } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import { Tips } from './primitives';

const Spinner = () => (
  <svg className='h-4 w-4 animate-spin' viewBox='0 0 24 24' fill='none'>
    <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
    <path
      className='opacity-75'
      fill='currentColor'
      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
    />
  </svg>
);

interface CustomFontsProps {
  bookKey: string;
  onBack: () => void;
}

type FontFamily = {
  name: string;
  fonts: CustomFont[];
};

const CustomFonts: React.FC<CustomFontsProps> = ({ bookKey, onBack }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  // `host` alone isn't a reliable "signed in" check: logout() clears it from
  // React state but leaves the `mybooks_host` localStorage key behind, so a
  // reload right after logout (before the next login) would rehydrate a
  // stale host while `user` stays correctly cleared. Gate on both.
  const { host, user } = useAuth();
  const { settings } = useSettingsStore();
  const {
    fonts: customFonts,
    addFont,
    loadFont,
    removeFont,
    getAvailableFonts,
    saveCustomFonts,
  } = useCustomFontStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  // null = idle, true = importing (spinner), { family } = done importing (show font name).
  // The card stays mounted throughout — only its content changes.
  const [importingFont, setImportingFont] = useState<true | { family: string } | null>(null);
  // Preset fonts download one at a time; holds the filename in progress.
  const [downloadingPreset, setDownloadingPreset] = useState<string | null>(null);

  const { selectFiles } = useFileSelector(appService, _);

  const currentDefaultFont =
    viewSettings.defaultFont.toLowerCase() === 'serif' ? 'serif' : 'sans-serif';

  const currentFontFamily =
    currentDefaultFont === 'serif' ? viewSettings.serifFont : viewSettings.sansSerifFont;

  const handleImportFont = () => {
    selectFiles({ type: 'fonts', multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      setImportingFont(true);
      try {
        for (const selectedFile of result.files) {
          const fontInfo = await appService?.importFont(selectedFile.path || selectedFile.file);
          if (!fontInfo) continue;

          // Replace the spinner with the resolved font family name in-place,
          // so the card stays at the same grid position without layout jump.
          setImportingFont({ family: fontInfo.family });

          const customFont = addFont(fontInfo.path, {
            name: fontInfo.name,
            family: fontInfo.family,
            style: fontInfo.style,
            weight: fontInfo.weight,
            variable: fontInfo.variable,
            contentId: fontInfo.contentId,
            bundleDir: fontInfo.bundleDir,
            byteSize: fontInfo.byteSize,
          });
          console.log('Added custom font:', customFont);
          if (customFont && !customFont.error) {
            const loadedFont = await loadFont(envConfig, customFont.id);
            mountCustomFont(document, loadedFont);
          }
        }
        saveCustomFonts(envConfig);
      } finally {
        // Keep the card visible — it now shows the font family name.
        // availableFamilies will pick it up on next render and the
        // importingFont card naturally becomes a regular font card.
        // We clear importingFont after a tick so availableFamilies
        // has a chance to include the new font first.
        setTimeout(() => setImportingFont(null), 0);
      }
    });
  };

  const handleDownloadPreset = async (preset: { name: string; filename: string }) => {
    if (!appService || !host || !user || downloadingPreset) return;
    setDownloadingPreset(preset.filename);
    try {
      // Preset fonts live on the MyBooks server the user is actually signed
      // into (self-hosted instances included), not the default mybooks.top.
      const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;
      const url = `${normalizedHost}/static/epubreader/assets/font/${preset.filename}`;
      const fontInfo = await appService.importFontFromUrl(url, preset.filename);
      if (!fontInfo) return;

      const customFont = addFont(fontInfo.path, {
        name: fontInfo.name,
        family: fontInfo.family,
        style: fontInfo.style,
        weight: fontInfo.weight,
        variable: fontInfo.variable,
        contentId: fontInfo.contentId,
        bundleDir: fontInfo.bundleDir,
        byteSize: fontInfo.byteSize,
      });
      if (customFont && !customFont.error) {
        const loadedFont = await loadFont(envConfig, customFont.id);
        mountCustomFont(document, loadedFont);
      }
      await saveCustomFonts(envConfig);
    } catch (err) {
      console.error('Failed to download preset font:', preset.name, err);
    } finally {
      setDownloadingPreset(null);
    }
  };

  const handleDeleteFamily = (family: FontFamily) => {
    for (const font of family.fonts) {
      if (font) {
        if (removeFont(font.id)) {
          appService?.deleteFont(font);
          saveCustomFonts(envConfig);
          if (getAvailableFonts().length === 0) {
            setIsDeleteMode(false);
          }
        }
      }
    }
  };

  const handleSelectFamily = (family: FontFamily) => {
    if (currentDefaultFont === 'serif') {
      saveViewSettings(envConfig, bookKey, 'serifFont', family.name);
    } else {
      saveViewSettings(envConfig, bookKey, 'sansSerifFont', family.name);
    }
  };

  const toggleDeleteMode = () => {
    setIsDeleteMode(!isDeleteMode);
  };

  const getAvailableFamilies = (fonts: CustomFont[]): FontFamily[] => {
    const familyMap = new Map<string, string[]>();

    for (const font of fonts) {
      const family = font.family || font.name;
      if (!familyMap.has(family)) {
        familyMap.set(family, []);
      }
      familyMap.get(family)!.push(font.id);
    }

    return Array.from(familyMap.entries()).map(([family, ids]) => ({
      name: family,
      fonts: ids.map((id) => fonts.find((f) => f.id === id)!).filter((f): f is CustomFont => !!f),
    }));
  };

  const availableFonts = customFonts
    .filter((font) => !font.deletedAt)
    .sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));

  // Exclude the font that's currently shown by the importingFont card so
  // we don't render two cards for the same font family.
  const importingFamily =
    importingFont && typeof importingFont === 'object' ? importingFont.family : null;
  const visibleFonts = importingFamily
    ? availableFonts.filter((f) => (f.family || f.name) !== importingFamily)
    : availableFonts;

  const availableFamilies = getAvailableFamilies(visibleFonts);

  // Preset fonts already downloaded live in `Fonts/<bundleDir>/<filename>` —
  // matching on the filename suffix is enough to tell them apart from other
  // imports without needing a dedicated field. Tauri-only for now (#web CORS
  // concerns for cross-origin `fetch` are unresolved), and only once signed
  // into a MyBooks server (the source of the preset files).
  const pendingPresets =
    isTauriAppPlatform() && host && user
      ? PRESET_CJK_FONTS.filter(
          (preset) => !availableFonts.some((font) => font.path.endsWith(`/${preset.filename}`)),
        )
      : [];

  return (
    <div className='w-full'>
      <div className='mb-6 flex h-8 items-center justify-between'>
        <div className='breadcrumbs py-1'>
          <ul>
            <li>
              <button className='font-semibold' onClick={onBack}>
                {_('Font')}
              </button>
            </li>
            <li className='font-medium'>{_('Custom Fonts')}</li>
          </ul>
        </div>
        {availableFonts.length > 0 && (
          <button
            onClick={toggleDeleteMode}
            className={`btn btn-ghost btn-sm text-base-content gap-2`}
            title={isDeleteMode ? _('Cancel Delete') : _('Delete Font')}
          >
            {isDeleteMode ? (
              <>{_('Cancel')}</>
            ) : (
              <>
                <MdDelete className='h-4 w-4' />
                {_('Delete')}
              </>
            )}
          </button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-4'>
        {/* Import Font — quiet outlined card matching the surrounding font
            family cards' visual weight (border-base-200 bg, hover lifts to
            base-200). Replaces the old loud `border-primary/50 text-primary`
            CTA styling. eink-bordered keeps the boundary visible in eink. */}
        <button
          type='button'
          onClick={handleImportFont}
          className={clsx(
            'bg-base-100 eink-bordered group flex h-12 items-center justify-center gap-2 rounded-2xl',
            'border-base-200 hover:border-base-300 hover:bg-base-300/40 border',
            'text-base-content text-sm font-medium',
            'transition-colors duration-150',
            'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <span
            className={clsx(
              // eink-inverted keeps the "+" legible on its dark badge (#4454).
              'eink-inverted',
              'flex h-5 w-5 items-center justify-center rounded-full',
              'bg-base-200 text-base-content/60',
              'transition-colors duration-150',
              'group-hover:bg-base-content group-hover:text-base-100',
            )}
          >
            <MdAdd className='h-3.5 w-3.5' />
          </span>
          <span className='line-clamp-1'>{_('Import Font')}</span>
        </button>

        {importingFont && (
          <div className='card border-base-200 bg-base-100 h-12 border shadow-sm'>
            <div className='card-body flex items-center justify-center p-2'>
              {typeof importingFont === 'object' ? (
                <div
                  style={{ fontFamily: `"${importingFont.family}", sans-serif`, fontWeight: 400 }}
                  className='text-base-content line-clamp-1 break-all'
                >
                  {importingFont.family}
                </div>
              ) : (
                <div className='flex items-center gap-2 text-sm text-base-content/60'>
                  <Spinner />
                  <span>{_('Importing...')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {availableFamilies.map((family) => (
          <div
            role='none'
            key={family.name}
            className={clsx(
              'card h-12 border shadow-sm',
              currentFontFamily === family.name
                ? // eink-bordered: bg-primary/50 dodges the eink normalizer, so
                  // without it the selected card is black-on-black (#4454).
                  'border-primary/50 bg-primary/50 eink-bordered'
                : `border-base-200 bg-base-100 ${isDeleteMode ? '' : 'cursor-pointer'}`,
            )}
            onClick={!isDeleteMode ? () => handleSelectFamily(family) : undefined}
            title={family.fonts.map((f) => f.name).join('\n')}
          >
            <div className='card-body flex items-center justify-center p-2'>
              <div
                style={{
                  fontFamily: `"${family.name}", sans-serif`,
                  fontWeight: 400,
                }}
                className='text-base-content line-clamp-1 break-all'
              >
                {family.name}
              </div>
              {isDeleteMode && (
                <button
                  onClick={() => handleDeleteFamily(family)}
                  className='btn btn-ghost btn-xs absolute right-[-10px] top-[-10px] h-6 min-h-0 w-6 p-0 hover:bg-transparent'
                  title={_('Delete Font')}
                >
                  <IoMdCloseCircleOutline className='text-base-content/75 h-6 w-6' />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingPresets.length > 0 && (
        <div className='mt-6'>
          <div className='text-base-content/60 mb-2 text-sm font-medium'>
            {_('MyBooks Preset Fonts')}
          </div>
          <div className='grid grid-cols-2 gap-4'>
            {pendingPresets.map((preset) => {
              const isDownloading = downloadingPreset === preset.filename;
              return (
                <button
                  key={preset.filename}
                  type='button'
                  onClick={() => handleDownloadPreset(preset)}
                  disabled={!!downloadingPreset}
                  className={clsx(
                    'card border-base-200 bg-base-100 eink-bordered h-12 border shadow-sm',
                    !downloadingPreset && 'hover:bg-base-300/40 cursor-pointer',
                  )}
                >
                  <div className='card-body flex flex-row items-center justify-center gap-2 p-2'>
                    {isDownloading ? (
                      <div className='flex items-center gap-2 text-sm text-base-content/60'>
                        <Spinner />
                        <span>{_('Downloading…')}</span>
                      </div>
                    ) : (
                      <>
                        <MdDownload className='h-4 w-4 text-base-content/60' />
                        <span className='text-base-content line-clamp-1 break-all text-sm'>
                          {preset.name}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Tips className='mt-6'>
        <li>{_('Supported font formats: .ttf, .otf, .woff, .woff2')}</li>
        <li>{_('Custom fonts can be selected from the Font Face menu')}</li>
      </Tips>
    </div>
  );
};

export default CustomFonts;
