import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTransferStore, type TransferItem } from '@/store/transferStore';
import { transferManager } from '@/services/transferManager';
import type { AudioTrack } from '@/services/audiobook/audiobookService';
import {
  deleteLocalAudiobook,
  getLocalAudiobookStatus,
  physicalFilename,
} from '@/services/audiobook/audiobookDownloader';

export type AudiobookTrackDownloadStatus = 'none' | 'downloading' | 'complete';

export interface UseAudiobookDownloadsResult {
  statusOf: (track: AudioTrack) => AudiobookTrackDownloadStatus;
  progressOf: (track: AudioTrack) => number; // 0-1, meaningful only while 'downloading'
  downloadedBytes: number;
  totalBytes: number;
  hasAnyLocal: boolean;
  downloadTrack: (track: AudioTrack) => void;
  downloadAll: () => void;
  deleteLocal: () => Promise<void>;
}

// Bridges the on-device download cache (audiobookDownloader.ts, probed
// on-demand — no separate manifest) with the live transferManager queue, so
// the offline-track list in AudiobookPlayerSheet reflects both "already
// downloaded" and "downloading right now" without polling the filesystem.
export function useAudiobookDownloads(
  bookId: number | null,
  tracks: AudioTrack[],
): UseAudiobookDownloadsResult {
  const { appService } = useEnv();
  const transfers = useTransferStore((s) => s.transfers);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadedFiles, setDownloadedFiles] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (!appService || bookId === null) return;
    void getLocalAudiobookStatus(appService, bookId, tracks).then((status) => {
      setDownloadedBytes(status.downloadedBytes);
      setTotalBytes(status.totalBytes);
      setDownloadedFiles(status.downloadedFiles);
    });
    // tracks is derived fresh per render from the session; comparing by
    // bookId is enough to avoid refetching on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const trackTransfers = useMemo(() => {
    const map = new Map<string, TransferItem>();
    if (bookId === null) return map;
    Object.values(transfers).forEach((t) => {
      if (t.kind === 'audiobook_track' && t.audiobook?.bookId === bookId) {
        map.set(t.audiobook.filename, t);
      }
    });
    return map;
  }, [transfers, bookId]);

  // A transfer landing on 'completed' means a new file exists on disk that
  // the last filesystem probe didn't see yet.
  const completedCount = Array.from(trackTransfers.values()).filter(
    (t) => t.status === 'completed',
  ).length;
  useEffect(() => {
    if (completedCount > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedCount]);

  const statusOf = useCallback(
    (track: AudioTrack): AudiobookTrackDownloadStatus => {
      const filename = physicalFilename(track);
      if (downloadedFiles.has(filename)) return 'complete';
      const transfer = trackTransfers.get(filename);
      if (transfer && (transfer.status === 'pending' || transfer.status === 'in_progress')) {
        return 'downloading';
      }
      return 'none';
    },
    [downloadedFiles, trackTransfers],
  );

  const progressOf = useCallback(
    (track: AudioTrack): number => {
      const transfer = trackTransfers.get(physicalFilename(track));
      return transfer ? transfer.progress / 100 : 0;
    },
    [trackTransfers],
  );

  const downloadTrack = useCallback(
    (track: AudioTrack) => {
      if (bookId === null) return;
      transferManager.queueAudiobookTrack(bookId, track);
    },
    [bookId],
  );

  const downloadAll = useCallback(() => {
    if (bookId === null) return;
    transferManager.queueAudiobookTracks(bookId, tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, tracks]);

  const deleteLocal = useCallback(async () => {
    if (!appService || bookId === null) return;
    await deleteLocalAudiobook(appService, bookId);
    refresh();
  }, [appService, bookId, refresh]);

  return {
    statusOf,
    progressOf,
    downloadedBytes,
    totalBytes,
    hasAnyLocal: downloadedFiles.size > 0,
    downloadTrack,
    downloadAll,
    deleteLocal,
  };
}
