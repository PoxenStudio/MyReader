'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MdContentCopy,
  MdErrorOutline,
  MdLogout,
  MdRefresh,
  MdVisibility,
  MdVisibilityOff,
} from 'react-icons/md';
import { PiUserCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useAuth } from '@/context/AuthContext';
import {
  getUserDetailInfo,
  updateUserSettings,
  uploadUserAvatar,
  getMyBooksAvatarUrl,
  signOut,
  type MyBooksUserDetailInfo,
} from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import Dialog from '@/components/Dialog';
import UserAvatar from '@/components/UserAvatar';

type RefreshStatus = 'idle' | 'loading' | 'error';

interface UserSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserSettingsDialog: React.FC<UserSettingsDialogProps> = ({ isOpen, onClose }) => {
  const _ = useTranslation();
  const { logout } = useAuth();
  const isSyncAllowed = useMyBooksStatusStore((state) => state.isSyncAllowed);

  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('loading');
  const [saving, setSaving] = useState(false);
  const [userInfo, setUserInfo] = useState<MyBooksUserDetailInfo | null>(null);

  const [nickname, setNickname] = useState('');
  const [password0, setPassword0] = useState('');
  const [password1, setPassword1] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [podcastToken, setPodcastToken] = useState('');

  const [showAvatarDialog, setShowAvatarDialog] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((type: 'success' | 'error', message: string) => {
    eventDispatcher.dispatch('toast', { type, message });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setRefreshStatus('loading');
    getUserDetailInfo()
      .then((info) => {
        if (info) {
          setUserInfo(info);
          setNickname(info.nickname || '');
          setPodcastToken(info.podcast_token || '');
        }
        setRefreshStatus('idle');
      })
      .catch((e) => {
        console.error(e);
        setRefreshStatus('error');
      });
  }, [isOpen]);

  const handleSave = async () => {
    if (nickname && nickname.length < 2) {
      toast('error', _('Nickname must be at least 2 characters'));
      return;
    }
    if (password1 && password1.length < 8) {
      toast('error', _('Password must be at least 8 characters'));
      return;
    }
    if (password1 && password1 !== password2) {
      toast('error', _('Passwords do not match'));
      return;
    }

    console.log('MyBooks sync allowed:', isSyncAllowed);

    setSaving(true);
    try {
      await updateUserSettings({
        nickname,
        password0,
        password1,
        password2,
        podcast_token: podcastToken,
      });
      toast('success', _('Settings saved'));
      setPassword0('');
      setPassword1('');
      setPassword2('');
      setShowPasswordForm(false);
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : _('Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const generatePodcastToken = () => {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    setPodcastToken(Array.from(array, (b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''));
  };

  const onAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast('error', _('Only PNG and JPEG images are supported'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('error', _('Image must be smaller than 2MB'));
      return;
    }
    setAvatarFile(file);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleUploadAvatar = async () => {
    if (!avatarFile) return;
    setUploadingAvatar(true);
    try {
      const avatarUrl = await uploadUserAvatar(avatarFile);
      if (userInfo) setUserInfo({ ...userInfo, avatar: avatarUrl });
      toast('success', _('Avatar updated'));
      closeAvatarDialog();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : _('Failed to upload avatar'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const closeAvatarDialog = () => {
    setShowAvatarDialog(false);
    setAvatarFile(null);
    if (avatarPreview) {
      URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // ignore errors — clear local state regardless
    } finally {
      logout();
      onClose();
    }
  };

  const avatarDisplayUrl = userInfo?.avatar ? getMyBooksAvatarUrl(userInfo.avatar) : null;

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={_('User Settings')}
        boxClassName='sm:min-w-[480px]'
        useOverlayScroll
      >
        {refreshStatus === 'loading' && !userInfo ? (
          <div className='flex justify-center py-12'>
            <span className='loading loading-spinner loading-md' />
          </div>
        ) : (
          <div className='flex flex-col gap-y-3 pb-4'>
            {/* Avatar */}
            <BoxedList title={_('Profile Picture')}>
              <SettingsRow label={_('Avatar')}>
                <div className='flex items-center gap-3'>
                  <div className='h-12 w-12 flex-shrink-0 overflow-hidden rounded-full bg-base-200'>
                    <UserAvatar
                      url={avatarDisplayUrl ?? ''}
                      size={48}
                      DefaultIcon={PiUserCircle}
                      fillContainer
                    />
                  </div>
                  {refreshStatus === 'loading' && (
                    <span className='loading loading-spinner loading-sm' />
                  )}
                  {refreshStatus === 'error' && (
                    <MdErrorOutline
                      className='text-error h-5 w-5'
                      title={_('Failed to refresh user info')}
                    />
                  )}
                  <button
                    type='button'
                    onClick={() => setShowAvatarDialog(true)}
                    className='btn btn-primary btn-sm eink-bordered'
                  >
                    {_('Change')}
                  </button>
                </div>
              </SettingsRow>
            </BoxedList>

            {/* Account info */}
            <BoxedList title={_('Account')}>
              <SettingsRow label={_('Email')}>
                <span className='text-base-content/60 text-sm'>{userInfo?.email || '-'}</span>
              </SettingsRow>
              <SettingsRow label={_('Nickname')}>
                <input
                  type='text'
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={_('Enter nickname')}
                  className='input input-sm eink-bordered w-36 text-right text-sm'
                />
              </SettingsRow>
            </BoxedList>

            {/* Password */}
            <BoxedList title={_('Security')}>
              <SettingsRow label={_('Change Password')}>
                <button
                  type='button'
                  onClick={() => setShowPasswordForm((v) => !v)}
                  className='btn btn-ghost btn-sm'
                >
                  {showPasswordForm ? (
                    <MdVisibilityOff className='h-4 w-4' />
                  ) : (
                    <MdVisibility className='h-4 w-4' />
                  )}
                </button>
              </SettingsRow>
              {showPasswordForm && (
                <>
                  <SettingsRow label={_('Current Password')}>
                    <input
                      type='password'
                      value={password0}
                      onChange={(e) => setPassword0(e.target.value)}
                      autoComplete='current-password'
                      placeholder=''
                      className='input input-sm eink-bordered w-36 text-right text-sm'
                    />
                  </SettingsRow>
                  <SettingsRow label={_('New Password')}>
                    <input
                      type='password'
                      value={password1}
                      onChange={(e) => setPassword1(e.target.value)}
                      autoComplete='new-password'
                      placeholder=''
                      className='input input-sm eink-bordered w-36 text-right text-sm'
                    />
                  </SettingsRow>
                  <SettingsRow label={_('Confirm Password')}>
                    <input
                      type='password'
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      autoComplete='new-password'
                      placeholder=''
                      className='input input-sm eink-bordered w-36 text-right text-sm'
                    />
                  </SettingsRow>
                </>
              )}
            </BoxedList>

            {/* Podcast / Audiobook Token */}
            <BoxedList title={_('Podcast / Audiobook Token')}>
              <SettingsRow label={_('Token')}>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    onClick={generatePodcastToken}
                    title={_('Generate new token')}
                    className='btn btn-ghost btn-sm'
                  >
                    <MdRefresh className='h-4 w-4' />
                  </button>
                  <button
                    type='button'
                    onClick={() => podcastToken && navigator.clipboard.writeText(podcastToken)}
                    title={_('Copy token')}
                    disabled={!podcastToken}
                    className='btn btn-ghost btn-sm'
                  >
                    <MdContentCopy className='h-4 w-4' />
                  </button>
                </div>
              </SettingsRow>
              {podcastToken && (
                <div className='px-3 pb-3 text-right'>
                  <span className='text-base-content/55 break-all font-mono text-[0.7em]'>
                    {podcastToken}
                  </span>
                </div>
              )}
            </BoxedList>

            {/* Save */}
            <div className='flex justify-center'>
              <button
                type='button'
                onClick={handleSave}
                disabled={saving}
                className='btn btn-primary eink-bordered w-1/2'
              >
                {saving ? <span className='loading loading-spinner loading-sm' /> : _('Save')}
              </button>
            </div>

            {/* Sign Out */}
            <div className='flex justify-center mt-[-5px]'>
              <button
                type='button'
                onClick={handleSignOut}
                className='btn btn-error eink-bordered w-1/2'
              >
                <MdLogout className='h-4 w-4' />
                {_('Sign Out')}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Avatar upload dialog */}
      <Dialog
        isOpen={showAvatarDialog}
        onClose={closeAvatarDialog}
        title={_('Change Avatar')}
        boxClassName='sm:!h-auto'
      >
        <div className='flex flex-col gap-4'>
          <p className='text-base-content/70 text-sm'>
            {_('Upload a PNG or JPEG image, max 2MB.')}
          </p>
          <div className='flex flex-col items-center gap-4'>
            <div className='h-24 w-24 overflow-hidden rounded-full bg-base-200'>
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={_('Preview')}
                  className='h-full w-full object-cover'
                />
              ) : (
                <PiUserCircle className='text-base-content/30 h-full w-full' />
              )}
            </div>
            <div className='input input-sm eink-bordered flex w-full items-center gap-2'>
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                className='btn btn-ghost btn-xs eink-bordered shrink-0'
              >
                {_('Choose File')}
              </button>
              <span className='text-base-content/70 truncate text-sm'>
                {avatarFile?.name ?? _('No file selected')}
              </span>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/png,image/jpeg'
                onChange={onAvatarFileChange}
                className='hidden'
              />
            </div>
          </div>
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={closeAvatarDialog}
              disabled={uploadingAvatar}
              className='btn btn-ghost btn-sm eink-bordered'
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              onClick={handleUploadAvatar}
              disabled={!avatarFile || uploadingAvatar}
              className='btn btn-primary btn-sm eink-bordered'
            >
              {uploadingAvatar ? (
                <span className='loading loading-spinner loading-xs' />
              ) : (
                _('Upload')
              )}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default UserSettingsDialog;
