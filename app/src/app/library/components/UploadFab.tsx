import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdFileUpload } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useTranslation } from '@/hooks/useTranslation';
import { fetchMyBooks } from '@/services/mybooksService';

interface BatchItem {
  id: number;
  name: string;
  title?: string;
  status: string;
  book_id?: number;
}

interface BatchStatus {
  items?: BatchItem[];
  importing?: boolean;
}

interface UploadFabProps {
  bottomOffset?: number;
  onUploaded?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  imported: 'badge-primary',
  exist: 'badge-ghost',
  ready: 'badge-success',
  drop: 'badge-warning',
  invalid: 'badge-error',
  isbn_invalid: 'badge-error',
  missed: 'badge-error',
  permission: 'badge-error',
};

const UploadFab: React.FC<UploadFabProps> = ({ bottomOffset = 0, onUploaded }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const safeBottom = useThemeStore((state) => state.safeAreaInsets?.bottom ?? 0) / 4;
  const { selectFiles } = useFileSelector(appService, _);
  const statusLabel = (status: string) => {
    switch (status) {
      case 'imported':
        return _('Imported successfully');
      case 'exist':
        return _('Same name exists');
      case 'ready':
        return _('Ready to import');
      case 'drop':
        return _('Duplicate file');
      case 'invalid':
        return _('Invalid file');
      case 'isbn_invalid':
        return _('Invalid ISBN');
      case 'missed':
        return _('File missing');
      case 'permission':
        return _('Insufficient permission');
      default:
        return _('Pending scan');
    }
  };

  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [batch, setBatch] = useState<BatchStatus>({});

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const toast = (type: 'success' | 'error', text: string) => setMessage({ type, text });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  // Poll batch import progress until the server finishes.
  useEffect(() => {
    if (!batchId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const rsp = await fetchMyBooks<unknown>('/book/upload/batch/status', {
          import_id: batchId,
        });
        const data = rsp as unknown as BatchStatus;
        if (stopped) return;
        setBatch(data);
        if (data.importing) {
          setTimeout(poll, 1500);
        } else {
          toast('success', _('Import completed'));
          onUploaded?.();
        }
      } catch {
        if (!stopped) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [batchId, onUploaded]);

  const closeBatch = () => {
    setBatchId(null);
    setOpen(false);
  };

  const handleClick = async () => {
    if (uploading || !appService) return;
    const result = await selectFiles({ type: 'books', multiple: true });
    if (result.error || result.files.length === 0) return;
    setUploading(true);
    try {
      // Read one at a time to keep peak memory low on mobile.
      const files: File[] = [];
      for (const f of result.files) {
        if (f.file) {
          files.push(f.file);
          continue;
        }
        // NativeFile is lazy: FormData can't serialize it, so read the bytes into a real File.
        const nf = await appService.openFile(f.path!, 'None');
        const bytes = await nf.arrayBuffer();
        console.log('[upload] read', nf.name, 'size', nf.size, 'bytes', bytes.byteLength);
        files.push(new File([bytes], nf.name, { type: nf.type }));
      }
      const data = new FormData();
      if (files.length === 1) {
        data.append('ebook', files[0]!, files[0]!.name);
        const rsp = await fetchMyBooks<unknown>('/book/upload', undefined, 'POST', data);
        const r = rsp as unknown as { err: string; msg?: string };
        if (r.err === 'ok') {
          toast('success', _('Upload succeeded'));
          onUploaded?.();
        } else {
          toast('error', r.msg || _('Upload failed'));
        }
      } else {
        files.forEach((f) => {
          data.append('ebooks', f, f.name);
          data.append('relative_paths', '');
        });
        const rsp = await fetchMyBooks<unknown>('/book/upload/batch', undefined, 'POST', data);
        const r = rsp as unknown as { err: string; msg?: string; import_id?: number };
        if (r.err === 'ok' && r.import_id) {
          setBatch({ importing: true, items: [] });
          setBatchId(r.import_id);
          setOpen(true);
        } else {
          toast('error', r.msg || _('Upload failed'));
        }
      }
    } catch (e) {
      toast('error', `${_('Upload failed')}: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      {message && (
        <div
          role='status'
          className={clsx(
            'fixed right-4 z-10 max-w-[80vw] rounded-lg px-3 py-2 text-sm text-white shadow-lg',
            message.type === 'success' ? 'bg-success' : 'bg-error',
          )}
          style={{ bottom: `calc(1rem + ${safeBottom}px + ${bottomOffset}px + 4.5rem)` }}
        >
          {message.text}
        </div>
      )}
      <button
        type='button'
        aria-label={_('Upload')}
        disabled={uploading}
        onClick={handleClick}
        className='fixed right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-[#e91e63] text-white shadow-lg active:opacity-80'
        style={{ bottom: `calc(1rem + ${safeBottom}px + ${bottomOffset}px)` }}
      >
        {uploading ? (
          <span className='loading loading-spinner loading-sm' />
        ) : (
          <MdFileUpload className='h-6 w-6' />
        )}
      </button>

      <Dialog
        isOpen={open}
        title={_('Batch import')}
        onClose={closeBatch}
        boxClassName='sm:min-w-[400px] sm:max-w-[560px] sm:!h-auto sm:max-h-[80%]'
        contentClassName='!px-5 !pb-4'
      >
        <div className='flex flex-col gap-3'>
          <div className='text-sm'>
            {batch.importing ? _('Importing...') : _('Import completed')}
          </div>
          <ul className='divide-base-300/50 max-h-80 divide-y overflow-y-auto text-sm'>
            {(batch.items ?? []).map((it) => (
              <li key={it.id} className='flex items-center gap-2 py-1.5'>
                <span
                  className={clsx(
                    'badge badge-sm flex-shrink-0 border-none',
                    STATUS_BADGE[it.status] ?? 'badge-neutral',
                  )}
                >
                  {statusLabel(it.status)}
                </span>
                <span className='truncate'>{it.title || it.name}</span>
              </li>
            ))}
          </ul>
          <div className='flex justify-end'>
            <button type='button' className='btn btn-sm btn-contrast min-w-24' onClick={closeBatch}>
              {_('Close')}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
};

export default UploadFab;
