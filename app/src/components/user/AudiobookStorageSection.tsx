import { useCallback, useEffect, useState } from 'react';
import { MdDeleteOutline } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { formatBytes } from '@/utils/book';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import {
  deleteLocalAudiobook,
  getAllLocalAudiobooks,
  type LocalAudiobookSummary,
} from '@/services/audiobook/audiobookDownloader';

// "有声书空间管理"：列出已缓存到本地的有声书及各自占用空间，支持单个/全部
// 删除。参见 design doc §6.5 —— 独立于全局 CacheManagerWindow（那个清的是
// 系统级 Cache/Temp 临时目录），因为这里是用户主动下载、要保留到手动删除的
// 数据。
const AudiobookStorageSection = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const library = useLibraryStore((s) => s.library);
  const [summaries, setSummaries] = useState<LocalAudiobookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);

  const refresh = useCallback(async () => {
    if (!appService) return;
    setLoading(true);
    try {
      setSummaries(await getAllLocalAudiobooks(appService));
    } finally {
      setLoading(false);
    }
  }, [appService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const titleFor = (bookId: number) =>
    library.find((b) => b.bookId === bookId)?.title ?? _('Book #{{id}}', { id: bookId });

  const handleDelete = async (bookId: number) => {
    if (!appService) return;
    await deleteLocalAudiobook(appService, bookId);
    await refresh();
  };

  const handleClearAll = async () => {
    if (!appService) return;
    const confirmed = await appService.ask(
      _('Delete all downloaded audiobooks? You can download them again anytime.'),
    );
    if (!confirmed) return;
    setClearingAll(true);
    try {
      await Promise.all(summaries.map((s) => deleteLocalAudiobook(appService, s.bookId)));
      await refresh();
    } finally {
      setClearingAll(false);
    }
  };

  if (loading || summaries.length === 0) {
    // Nothing downloaded (or still probing) — keep Settings uncluttered.
    return null;
  }

  const totalBytes = summaries.reduce((sum, s) => sum + s.sizeBytes, 0);

  return (
    <BoxedList title={_('Audiobook Storage')}>
      {summaries.map((summary) => (
        <SettingsRow
          key={summary.bookId}
          label={titleFor(summary.bookId)}
          description={formatBytes(summary.sizeBytes)}
        >
          <button
            type='button'
            onClick={() => void handleDelete(summary.bookId)}
            title={_('Delete')}
            className='btn btn-ghost btn-sm'
          >
            <MdDeleteOutline className='h-4 w-4' />
          </button>
        </SettingsRow>
      ))}
      <SettingsRow label={_('Total')} description={formatBytes(totalBytes)}>
        <button
          type='button'
          onClick={() => void handleClearAll()}
          disabled={clearingAll}
          className='btn btn-ghost btn-sm text-error'
        >
          {_('Clear all')}
        </button>
      </SettingsRow>
    </BoxedList>
  );
};

export default AudiobookStorageSection;
