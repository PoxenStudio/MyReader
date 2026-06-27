'use client';

import React, { useEffect, useState } from 'react';
import { MdDevices } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { Book, BookFormat } from '@/types/book';
import { getMyBooksId } from '@/utils/bookConverter';
import {
  getUserDevices,
  sendBookToDevice,
  type MyBooksDevice,
  type MyBooksDeviceType,
  type MyBooksSendToDeviceParams,
} from '@/services/mybooksService';

interface SendToDeviceDialogProps {
  isOpen: boolean;
  book: Book | null;
  onClose: () => void;
}

const COMPATIBLE_FORMATS: BookFormat[] = ['EPUB', 'AZW3', 'PDF', 'MOBI', 'TXT'];
const FORMAT_PRIORITY: BookFormat[] = ['EPUB', 'AZW3', 'PDF', 'MOBI', 'TXT'];

const DEVICE_TYPE_LABELS: Record<MyBooksDeviceType, string> = {
  duokan: 'Duokan Reader',
  ireader: 'iReader',
  hanwang: 'Hanvon',
  boox: 'Boox',
  dangdang: 'Dangdang Reader',
  kindle: 'Kindle',
  purelibro: 'PureLibro',
  ftp: 'FTP',
};

// Temporary (one-off, unsaved) devices don't support FTP — that needs
// credentials/paths that aren't worth typing in for a single send.
const TEMP_DEVICE_TYPES: MyBooksDeviceType[] = [
  'duokan',
  'ireader',
  'hanwang',
  'boox',
  'dangdang',
  'kindle',
  'purelibro',
];

const DEFAULT_TEMP_DEVICE = {
  type: 'duokan' as MyBooksDeviceType,
  ip: '',
  port: 12121,
  mailbox: '',
};

const SendToDeviceDialog: React.FC<SendToDeviceDialogProps> = ({ isOpen, book, onClose }) => {
  const _ = useTranslation();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [devices, setDevices] = useState<MyBooksDevice[]>([]);
  // 'saved-<idx>' for a saved device, 'temporary' for the one-off form below.
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [tempDevice, setTempDevice] = useState(DEFAULT_TEMP_DEVICE);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setSelectedOption(null);
    setTempDevice(DEFAULT_TEMP_DEVICE);
    getUserDevices()
      .then((list) => {
        setDevices(list);
        setSelectedOption(list.length > 0 ? 'saved-0' : 'temporary');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!book) return null;

  const availableFormats = Array.from(new Set((book.files ?? []).map((f) => f.format)));
  const hasCompatibleFormats = availableFormats.some((f) => COMPATIBLE_FORMATS.includes(f));
  const selectedFormat = FORMAT_PRIORITY.find((f) => availableFormats.includes(f)) ?? '';

  const isTemporary = selectedOption === 'temporary';
  const selectedDevice =
    !isTemporary && selectedOption ? devices[Number(selectedOption.replace('saved-', ''))] : null;

  const canSend = isTemporary
    ? tempDevice.type === 'kindle'
      ? !!tempDevice.mailbox
      : !!(tempDevice.ip && tempDevice.port)
    : !!selectedDevice;

  const describeDevice = (device: MyBooksDevice) => {
    const typeLabel = _(DEVICE_TYPE_LABELS[device.type] ?? device.type);
    if (device.type === 'kindle') {
      return `${device.name} (${typeLabel}) - ${device.mailbox}`;
    }
    if (device.type === 'ftp') {
      return `${device.name} (${typeLabel}) - ${device.ip}:${device.port} ${device.ftp_path ?? ''}`;
    }
    return `${device.name} (${typeLabel}) - ${device.ip}:${device.port}`;
  };

  const handleSend = async () => {
    if (!canSend || sending) return;
    const bookId = getMyBooksId(book);
    if (!bookId) return;

    let params: MyBooksSendToDeviceParams;
    let deviceName: string;
    if (isTemporary) {
      deviceName = _('Temporary Device');
      params =
        tempDevice.type === 'kindle'
          ? { device_type: 'kindle', mailbox: tempDevice.mailbox }
          : {
              device_type: tempDevice.type,
              device_url: `http://${tempDevice.ip}:${tempDevice.port}`,
            };
    } else if (!selectedDevice) {
      return;
    } else {
      deviceName = selectedDevice.name;
      if (selectedDevice.type === 'kindle') {
        params = { device_type: 'kindle', mailbox: selectedDevice.mailbox };
      } else if (selectedDevice.type === 'ftp') {
        params = {
          device_type: 'ftp',
          device_url: `${selectedDevice.ip}:${selectedDevice.port}`,
          ftp_username: selectedDevice.ftp_username || '',
          ftp_password: selectedDevice.ftp_password || '',
          ftp_path: selectedDevice.ftp_path || '',
        };
      } else {
        params = {
          device_type: selectedDevice.type,
          device_url: `${selectedDevice.schema || 'http'}://${selectedDevice.ip}:${selectedDevice.port}`,
        };
      }
    }

    setSending(true);
    try {
      await sendBookToDevice(bookId, params);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Sent to {{name}}', { name: deviceName }),
      });
      onClose();
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : _('Failed to send to device'),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Send to Device')}
      boxClassName='sm:min-w-[480px]'
    >
      <div className='flex flex-col gap-y-3 pb-4'>
        <div className='flex items-center gap-2'>
          <MdDevices className='h-5 w-5' />
          <span className='text-sm'>
            {_('Select a device')}
            {selectedFormat && (
              <span className='text-base-content/60 ml-1'>
                ({_('Will send as {{format}}', { format: selectedFormat })})
              </span>
            )}
          </span>
        </div>

        {loading ? (
          <div className='flex justify-center py-8'>
            <span className='loading loading-spinner loading-md' />
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {devices.map((device, idx) => (
              <label
                key={idx}
                className='eink-bordered flex cursor-pointer items-center gap-2 rounded-md border border-base-200 p-2 text-sm'
              >
                <input
                  type='radio'
                  name='send-to-device'
                  className='radio radio-sm'
                  checked={selectedOption === `saved-${idx}`}
                  onChange={() => setSelectedOption(`saved-${idx}`)}
                />
                <span>{describeDevice(device)}</span>
              </label>
            ))}

            <label className='eink-bordered flex cursor-pointer items-center gap-2 rounded-md border border-base-200 p-2 text-sm'>
              <input
                type='radio'
                name='send-to-device'
                className='radio radio-sm'
                checked={isTemporary}
                onChange={() => setSelectedOption('temporary')}
              />
              <span>{_('Temporary Device')}</span>
            </label>

            {isTemporary && (
              <div className='flex flex-col gap-2 pl-8'>
                <select
                  value={tempDevice.type}
                  onChange={(e) =>
                    setTempDevice((d) => ({ ...d, type: e.target.value as MyBooksDeviceType }))
                  }
                  className='select select-sm eink-bordered'
                >
                  {TEMP_DEVICE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === 'kindle' ? 'Kindle' : _(DEVICE_TYPE_LABELS[type])}
                    </option>
                  ))}
                </select>

                {tempDevice.type === 'kindle' ? (
                  <input
                    type='email'
                    value={tempDevice.mailbox}
                    onChange={(e) => setTempDevice((d) => ({ ...d, mailbox: e.target.value }))}
                    placeholder='user@kindle.com'
                    className='input input-sm eink-bordered w-full'
                  />
                ) : (
                  <div className='flex gap-2'>
                    <input
                      type='text'
                      value={tempDevice.ip}
                      onChange={(e) => setTempDevice((d) => ({ ...d, ip: e.target.value }))}
                      placeholder={_('Device IP')}
                      className='input input-sm eink-bordered min-w-0 flex-1'
                    />
                    <input
                      type='number'
                      value={tempDevice.port}
                      onChange={(e) =>
                        setTempDevice((d) => ({ ...d, port: Number(e.target.value) }))
                      }
                      placeholder={_('Port')}
                      className='input input-sm eink-bordered w-24'
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!hasCompatibleFormats && (
          <p className='text-error text-xs'>
            {_('This book has no format compatible with device delivery.')}
          </p>
        )}

        <div className='mt-2 flex justify-end gap-2'>
          <button type='button' onClick={onClose} className='btn btn-ghost btn-sm eink-bordered'>
            {_('Cancel')}
          </button>
          <button
            type='button'
            onClick={handleSend}
            disabled={!canSend || !hasCompatibleFormats || sending}
            className='btn btn-primary btn-sm eink-bordered'
          >
            {sending ? <span className='loading loading-spinner loading-xs' /> : _('Send')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default SendToDeviceDialog;
