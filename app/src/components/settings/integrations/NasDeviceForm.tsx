import { useState } from 'react';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { NAS_MIN_EXPIRY_MINUTES, NasVendorType } from '@/types/settings';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from '../primitives';

interface NasDeviceFormProps {
  onBack: () => void;
}

const isValidHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * NAS remote-access sub-page. Some NAS setups require logging into the NAS
 * device itself (which sets cookies) before the MyReader server hosted on
 * that NAS will respond — this configures when/how MyReader re-prompts that
 * NAS login. Mirrors WebDAVForm's shape: a boxed config form that persists
 * via `saveSettings`, plus a manual connection test.
 */
const NasDeviceForm: React.FC<NasDeviceFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.nas;

  const [vendor, setVendor] = useState<NasVendorType>(stored?.vendor ?? 'other');
  const [loginUrl, setLoginUrl] = useState(stored?.loginUrl ?? '');
  const [expiryMinutes, setExpiryMinutes] = useState(
    stored?.expiryMinutes ?? NAS_MIN_EXPIRY_MINUTES,
  );
  const [autoPromptOnExpiry, setAutoPromptOnExpiry] = useState(stored?.autoPromptOnExpiry ?? false);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const persistNas = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, nas: { ...latest.nas, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleToggleEnabled = async () => {
    await persistNas({ enabled: !stored?.enabled });
  };

  const handleSave = async () => {
    if (!isValidHttpsUrl(loginUrl)) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Please enter a valid https:// address'),
      });
      return;
    }
    const minutes = Math.max(NAS_MIN_EXPIRY_MINUTES, Math.round(expiryMinutes) || 0);
    setExpiryMinutes(minutes);
    await persistNas({ vendor, loginUrl, expiryMinutes: minutes, autoPromptOnExpiry });
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Saved') });
  };

  /**
   * "Connectable" just means the NAS address answers at all — any HTTP
   * response (even a login redirect or 4xx) proves the server is reachable.
   * We don't need an actual login/cookie exchange for this check, so it's a
   * plain request instead of opening the login popup.
   */
  const handleTestConnection = async () => {
    if (!isValidHttpsUrl(loginUrl)) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Please enter a valid https:// address'),
      });
      return;
    }
    setTestStatus('idle');
    setIsTesting(true);
    try {
      await tauriFetch(loginUrl, {
        method: 'GET',
        danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
      });
      setTestStatus('success');
    } catch (e) {
      console.error('NAS connection test failed:', e);
      setTestStatus('error');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('NAS Device')}
        description={_('Log in to a NAS device before MyReader can reach the server it hosts.')}
        onBack={onBack}
      />

      <div className='space-y-5'>
        <BoxedList>
          <SettingsSwitchRow
            label={_('Support remote NAS device access')}
            checked={!!stored?.enabled}
            onChange={handleToggleEnabled}
          />
        </BoxedList>

        {stored?.enabled && (
          <>
            <BoxedList>
              <SettingsRow label={_('Vendor')}>
                <SettingsSelect
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value as NasVendorType)}
                  ariaLabel={_('Vendor')}
                  options={[
                    { value: 'fnos', label: _('fnOS') },
                    { value: 'ugreen', label: _('UGREEN') },
                    { value: 'synology', label: _('Synology') },
                    { value: 'zspace', label: _('ZSpace') },
                    { value: 'other', label: _('Other') },
                  ]}
                />
              </SettingsRow>
              <SettingsRow label={_('NAS Address')}>
                <SettingsInput
                  type='url'
                  placeholder='https://nas.example.com'
                  spellCheck='false'
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                />
              </SettingsRow>
              <SettingsRow label={_('Session Expiry (minutes)')}>
                <SettingsInput
                  type='number'
                  min={NAS_MIN_EXPIRY_MINUTES}
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(Number(e.target.value))}
                />
              </SettingsRow>
              <SettingsSwitchRow
                label={_('Auto-open login when expired')}
                checked={autoPromptOnExpiry}
                onChange={() => setAutoPromptOnExpiry((v) => !v)}
              />
            </BoxedList>

            <div className='flex items-center justify-between gap-2 px-1'>
              <p className='text-sm'>
                {testStatus === 'success' && (
                  <span className='text-success'>{_('Connection successful')}</span>
                )}
                {testStatus === 'error' && (
                  <span className='text-error'>{_('Connection failed')}</span>
                )}
              </p>
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className='eink-bordered h-10 rounded-lg px-4 text-sm font-medium transition-colors duration-150 disabled:opacity-60'
                >
                  {isTesting ? (
                    <span className='loading loading-spinner loading-xs' />
                  ) : (
                    _('Test Connection')
                  )}
                </button>
                <button
                  type='button'
                  onClick={handleSave}
                  className='btn btn-primary h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium'
                >
                  {_('Save')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NasDeviceForm;
