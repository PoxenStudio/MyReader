'use client';

import { useEffect, useState } from 'react';
import { MdAdd, MdDelete } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import {
  getUserDevices,
  updateUserDevices,
  type MyBooksDevice,
  type MyBooksDeviceType,
} from '@/services/mybooksService';
import Dialog from '@/components/Dialog';

interface DeviceManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_DEVICE: MyBooksDevice = {
  name: '',
  type: 'duokan',
  ip: '',
  port: 12121,
  schema: 'http',
  mailbox: '',
};

const DeviceManagementDialog: React.FC<DeviceManagementDialogProps> = ({ isOpen, onClose }) => {
  const _ = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<MyBooksDevice[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getUserDevices()
      .then(setDevices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen]);

  const deviceTypeOptions: { value: MyBooksDeviceType; label: string }[] = [
    { value: 'duokan', label: _('Duokan Reader') },
    { value: 'ireader', label: _('iReader') },
    { value: 'hanwang', label: _('Hanvon') },
    { value: 'boox', label: _('Boox') },
    { value: 'dangdang', label: _('Dangdang Reader') },
    { value: 'kindle', label: 'Kindle' },
    { value: 'purelibro', label: 'PureLibro' },
    { value: 'ftp', label: 'FTP' },
  ];

  const updateDevice = (idx: number, patch: Partial<MyBooksDevice>) => {
    setDevices((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addDevice = () => {
    setDevices((prev) => [...prev, { ...DEFAULT_DEVICE, name: _('My Device') }]);
  };

  const removeDevice = (idx: number) => {
    setDevices((prev) => prev.filter((_d, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUserDevices(devices);
      eventDispatcher.dispatch('toast', { type: 'success', message: _('Devices saved') });
      onClose();
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : _('Failed to save devices'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('My Devices')}
      boxClassName='sm:min-w-[560px]'
      useOverlayScroll
    >
      {loading ? (
        <div className='flex justify-center py-12'>
          <span className='loading loading-spinner loading-md' />
        </div>
      ) : (
        <div className='flex flex-col gap-y-3 pb-4'>
          <p className='text-base-content/65 text-sm'>
            {_('Manage the devices you can send books to from your bookshelf.')}
          </p>

          {devices.map((device, idx) => (
            <div key={idx} className='card eink-bordered border-base-200 bg-base-100 border p-3'>
              <div className='mb-2 flex items-center gap-2'>
                <input
                  type='text'
                  value={device.name}
                  onChange={(e) => updateDevice(idx, { name: e.target.value })}
                  placeholder={_('Device Name')}
                  maxLength={64}
                  className='input input-sm eink-bordered flex-1'
                />
                <select
                  value={device.type}
                  onChange={(e) => updateDevice(idx, { type: e.target.value as MyBooksDeviceType })}
                  className='select select-sm eink-bordered'
                >
                  {deviceTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type='button'
                  onClick={() => removeDevice(idx)}
                  title={_('Remove Device')}
                  className='btn btn-ghost btn-sm'
                >
                  <MdDelete className='h-4 w-4' />
                </button>
              </div>

              {device.type === 'kindle' ? (
                <input
                  type='email'
                  value={device.mailbox}
                  onChange={(e) => updateDevice(idx, { mailbox: e.target.value })}
                  placeholder='user@kindle.com'
                  className='input input-sm eink-bordered w-full'
                />
              ) : (
                <div className='flex flex-wrap gap-2'>
                  <input
                    type='text'
                    value={device.ip}
                    onChange={(e) => updateDevice(idx, { ip: e.target.value })}
                    placeholder={_('Device IP')}
                    className='input input-sm eink-bordered min-w-0 flex-1'
                  />
                  <input
                    type='number'
                    value={device.port}
                    onChange={(e) => updateDevice(idx, { port: Number(e.target.value) })}
                    placeholder={_('Port')}
                    className='input input-sm eink-bordered w-24'
                  />
                  {device.type === 'ftp' ? (
                    <>
                      <input
                        type='text'
                        value={device.ftp_username ?? ''}
                        onChange={(e) => updateDevice(idx, { ftp_username: e.target.value })}
                        placeholder={_('FTP Username')}
                        autoComplete='off'
                        className='input input-sm eink-bordered min-w-0 flex-1'
                      />
                      <input
                        type='password'
                        value={device.ftp_password ?? ''}
                        onChange={(e) => updateDevice(idx, { ftp_password: e.target.value })}
                        placeholder={_('FTP Password')}
                        autoComplete='new-password'
                        className='input input-sm eink-bordered min-w-0 flex-1'
                      />
                      <input
                        type='text'
                        value={device.ftp_path ?? ''}
                        onChange={(e) => updateDevice(idx, { ftp_path: e.target.value })}
                        placeholder='/books'
                        className='input input-sm eink-bordered w-full'
                      />
                    </>
                  ) : (
                    <select
                      value={device.schema}
                      onChange={(e) => updateDevice(idx, { schema: e.target.value })}
                      className='select select-sm eink-bordered'
                    >
                      <option value='http'>http</option>
                      <option value='https'>https</option>
                    </select>
                  )}
                </div>
              )}
            </div>
          ))}

          <button
            type='button'
            onClick={addDevice}
            className='btn btn-ghost btn-sm eink-bordered self-center'
          >
            <MdAdd className='h-4 w-4' />
            {_('Add Device')}
          </button>

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
        </div>
      )}
    </Dialog>
  );
};

export default DeviceManagementDialog;
