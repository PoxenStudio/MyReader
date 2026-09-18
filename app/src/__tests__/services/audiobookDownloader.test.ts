import { describe, expect, it, vi } from 'vitest';
import type { AppService, FileItem } from '@/types/system';
import type { AudioTrack } from '@/services/audiobook/audiobookService';
import {
  audiobookDir,
  dedupeTracksByFile,
  deleteLocalAudiobook,
  getAllLocalAudiobooks,
  getLocalAudiobookStatus,
  resolveLocalPlaybackUrl,
} from '@/services/audiobook/audiobookDownloader';

const track = (overrides: Partial<AudioTrack> = {}): AudioTrack => ({
  filename: 'ch1',
  url: 'https://mybooks.local/api/audio/5/0001_ch1.mp3',
  size: 1000,
  ...overrides,
});

// Minimal fake covering only the AppService methods audiobookDownloader
// actually calls.
function fakeAppService(overrides: Partial<AppService> = {}): AppService {
  return {
    readDirectory: vi.fn().mockResolvedValue([]),
    exists: vi.fn().mockResolvedValue(false),
    deleteDir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    ...overrides,
  } as unknown as AppService;
}

describe('dedupeTracksByFile', () => {
  it('keeps m4b virtual chapters that share the same physical file only once', () => {
    const shared = 'https://mybooks.local/api/audio/5/book.m4b';
    const tracks = [
      track({ filename: 'Chapter 1', url: shared, start_time: 0, end_time: 100 }),
      track({ filename: 'Chapter 2', url: shared, start_time: 100, end_time: 200 }),
      track({ filename: 'ch2', url: 'https://mybooks.local/api/audio/5/0002_ch2.mp3' }),
    ];
    const result = dedupeTracksByFile(tracks);
    expect(result).toHaveLength(2);
    expect(result[0]!.url).toBe(shared);
    expect(result[1]!.filename).toBe('ch2');
  });
});

describe('getLocalAudiobookStatus', () => {
  it('reports no downloaded bytes when the local directory is empty/missing', async () => {
    const appService = fakeAppService({
      readDirectory: vi.fn().mockRejectedValue(new Error('nope')),
    });
    const status = await getLocalAudiobookStatus(appService, 5, [track()]);
    expect(status).toEqual({ downloadedBytes: 0, totalBytes: 1000, downloadedFiles: new Set() });
  });

  it('matches local files by physical filename, deduping m4b virtual chapters', async () => {
    const shared = 'https://mybooks.local/api/audio/5/book.m4b';
    const tracks = [
      track({ filename: 'Chapter 1', url: shared, size: 5000, start_time: 0, end_time: 100 }),
      track({ filename: 'Chapter 2', url: shared, size: 5000, start_time: 100, end_time: 200 }),
    ];
    const entries: FileItem[] = [{ path: 'book.m4b', size: 4800 }];
    const appService = fakeAppService({ readDirectory: vi.fn().mockResolvedValue(entries) });

    const status = await getLocalAudiobookStatus(appService, 5, tracks);

    expect(status.downloadedFiles).toEqual(new Set(['book.m4b']));
    expect(status.totalBytes).toBe(5000); // deduped
    expect(status.downloadedBytes).toBe(5000);
    expect(appService.readDirectory).toHaveBeenCalledWith(audiobookDir(5), 'Books');
  });

  it('reports partial download status when only some files are present', async () => {
    const tracks = [
      track({ filename: 'ch1', url: 'https://mybooks.local/api/audio/5/0001_ch1.mp3', size: 100 }),
      track({ filename: 'ch2', url: 'https://mybooks.local/api/audio/5/0002_ch2.mp3', size: 200 }),
    ];
    const entries: FileItem[] = [{ path: '0001_ch1.mp3', size: 100 }];
    const appService = fakeAppService({ readDirectory: vi.fn().mockResolvedValue(entries) });

    const status = await getLocalAudiobookStatus(appService, 5, tracks);

    expect(status.downloadedBytes).toBe(100);
    expect(status.totalBytes).toBe(300);
    expect(status.downloadedFiles.has('0001_ch1.mp3')).toBe(true);
    expect(status.downloadedFiles.has('0002_ch2.mp3')).toBe(false);
  });
});

describe('deleteLocalAudiobook', () => {
  it('deletes the book directory recursively when it exists', async () => {
    const appService = fakeAppService({ exists: vi.fn().mockResolvedValue(true) });
    await deleteLocalAudiobook(appService, 5);
    expect(appService.deleteDir).toHaveBeenCalledWith(audiobookDir(5), 'Books', true);
  });

  it('is a no-op when nothing is downloaded', async () => {
    const appService = fakeAppService({ exists: vi.fn().mockResolvedValue(false) });
    await deleteLocalAudiobook(appService, 5);
    expect(appService.deleteDir).not.toHaveBeenCalled();
  });
});

describe('getAllLocalAudiobooks', () => {
  it('groups downloaded files by book id and sums their size', async () => {
    const entries: FileItem[] = [
      { path: '5/0001_ch1.mp3', size: 100 },
      { path: '5/0002_ch2.mp3', size: 200 },
      { path: '9/0001_ch1.mp3', size: 50 },
    ];
    const appService = fakeAppService({ readDirectory: vi.fn().mockResolvedValue(entries) });

    const summaries = await getAllLocalAudiobooks(appService);

    expect(summaries).toEqual(
      expect.arrayContaining([
        { bookId: 5, sizeBytes: 300 },
        { bookId: 9, sizeBytes: 50 },
      ]),
    );
  });

  it('returns an empty list when nothing has been downloaded', async () => {
    const appService = fakeAppService({
      readDirectory: vi.fn().mockRejectedValue(new Error('nope')),
    });
    expect(await getAllLocalAudiobooks(appService)).toEqual([]);
  });
});

describe('resolveLocalPlaybackUrl', () => {
  it('returns null when the file is not downloaded', async () => {
    const appService = fakeAppService({ exists: vi.fn().mockResolvedValue(false) });
    expect(await resolveLocalPlaybackUrl(appService, 5, track())).toBeNull();
  });

  it('reads the local file into a blob URL when present', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:local-file');
    vi.stubGlobal('URL', { ...URL, createObjectURL });
    const appService = fakeAppService({
      exists: vi.fn().mockResolvedValue(true),
      readFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    const url = await resolveLocalPlaybackUrl(appService, 5, track());

    expect(url).toBe('blob:local-file');
    expect(appService.readFile).toHaveBeenCalledWith(
      `${audiobookDir(5)}/0001_ch1.mp3`,
      'Books',
      'binary',
    );
    vi.unstubAllGlobals();
  });
});
