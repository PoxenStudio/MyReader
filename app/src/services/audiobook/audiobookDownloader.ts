// Local (on-device) audiobook file cache: pure filesystem operations only —
// no network downloads here. Downloads themselves go through transferManager
// (see design doc §5.11/§6.4) so they persist and keep running in the
// background; this module only answers "what's already on disk" and cleans
// it up.
//
// Files live under BaseDir 'Books' (not 'Cache' — see §5.11: 'Cache' is
// treated as freely wipeable by CacheManagerWindow, but a user-initiated
// audiobook download is meant to persist until explicitly deleted), in
// `audiobooks/<bookId>/<physical filename>`.
//
// m4b files with embedded chapters arrive as several AudioTrack entries that
// share one physical `url` (see webserver/handlers/audio.py's
// _extract_m4b_chapters); every dedupe/download/status operation here keys
// on that physical filename, not `track.filename` (which for an m4b chapter
// is the chapter title, not a file on disk).

import type { AppService, FileItem } from '@/types/system';
import type { AudioTrack } from './audiobookService';

const AUDIOBOOKS_ROOT = 'audiobooks';

export const audiobookDir = (bookId: number): string => `${AUDIOBOOKS_ROOT}/${bookId}`;

export function physicalFilename(track: Pick<AudioTrack, 'url' | 'filename'>): string {
  try {
    const path = track.url.split('?')[0] ?? '';
    const last = path.split('/').pop();
    return last ? decodeURIComponent(last) : track.filename;
  } catch {
    return track.filename;
  }
}

export function dedupeTracksByFile(tracks: AudioTrack[]): AudioTrack[] {
  const seen = new Set<string>();
  const result: AudioTrack[] = [];
  for (const track of tracks) {
    const key = physicalFilename(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

async function readLocalFiles(
  appService: AppService,
  bookId: number,
): Promise<Map<string, number>> {
  try {
    const entries = await appService.readDirectory(audiobookDir(bookId), 'Books');
    return new Map(entries.map((entry) => [entry.path, entry.size]));
  } catch {
    // No directory yet (nothing downloaded) — not an error.
    return new Map();
  }
}

export interface LocalAudiobookStatus {
  downloadedBytes: number;
  totalBytes: number;
  downloadedFiles: Set<string>;
}

export async function getLocalAudiobookStatus(
  appService: AppService,
  bookId: number,
  tracks: AudioTrack[],
): Promise<LocalAudiobookStatus> {
  const localFiles = await readLocalFiles(appService, bookId);
  const uniqueTracks = dedupeTracksByFile(tracks);

  let downloadedBytes = 0;
  let totalBytes = 0;
  const downloadedFiles = new Set<string>();
  for (const track of uniqueTracks) {
    const filename = physicalFilename(track);
    totalBytes += track.size;
    if (localFiles.has(filename)) {
      downloadedBytes += track.size;
      downloadedFiles.add(filename);
    }
  }
  return { downloadedBytes, totalBytes, downloadedFiles };
}

export async function deleteLocalAudiobook(appService: AppService, bookId: number): Promise<void> {
  try {
    if (await appService.exists(audiobookDir(bookId), 'Books')) {
      await appService.deleteDir(audiobookDir(bookId), 'Books', true);
    }
  } catch {
    // Best-effort cleanup; a failed delete leaves the (harmless) files behind
    // rather than surfacing an error the user can't act on.
  }
}

export interface LocalAudiobookSummary {
  bookId: number;
  sizeBytes: number;
}

// Used by the "有声书空间管理" section in UserSettingsDialog (§6.5) to list
// every downloaded audiobook and its size.
export async function getAllLocalAudiobooks(
  appService: AppService,
): Promise<LocalAudiobookSummary[]> {
  let entries: FileItem[] = [];
  try {
    entries = await appService.readDirectory(AUDIOBOOKS_ROOT, 'Books');
  } catch {
    return [];
  }
  const totals = new Map<number, number>();
  for (const entry of entries) {
    const bookId = Number(entry.path.split('/')[0]);
    if (!Number.isFinite(bookId)) continue;
    totals.set(bookId, (totals.get(bookId) ?? 0) + entry.size);
  }
  return Array.from(totals.entries()).map(([bookId, sizeBytes]) => ({ bookId, sizeBytes }));
}

// Local-first playback source for AudiobookSessionManager's
// `resolvePlaybackUrl` hook. Reads the whole file into memory as a Blob URL
// — an acceptable trade-off for v1 (chapter files are at most tens of MB); a
// streaming file:// URL (Tauri's convertFileSrc) would avoid the full read
// but needs a new AppService method, left as a follow-up.
export async function resolveLocalPlaybackUrl(
  appService: AppService,
  bookId: number,
  track: AudioTrack,
): Promise<string | null> {
  const path = `${audiobookDir(bookId)}/${physicalFilename(track)}`;
  try {
    if (!(await appService.exists(path, 'Books'))) return null;
    const content = await appService.readFile(path, 'Books', 'binary');
    return URL.createObjectURL(new Blob([content as ArrayBuffer]));
  } catch {
    return null;
  }
}
