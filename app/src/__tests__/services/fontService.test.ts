import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return {
    ...actual,
    partialMD5: vi.fn(async () => 'partial-md5-stub'),
  };
});
vi.mock('@/utils/misc', async () => {
  const actual = await vi.importActual<typeof import('@/utils/misc')>('@/utils/misc');
  return {
    ...actual,
    uniqueId: vi.fn(() => 'bundle-1'),
  };
});
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue({}),
}));

import { importFontFromUrl } from '@/services/fontService';
import { downloadFile } from '@/libs/storage';
import { AppService, FileSystem } from '@/types/system';

// Minimal valid sfnt header (signature + zero tables) — enough for
// parseFontInfo's fallback (filename-derived) path.
function makeFontBytes(): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, 0, false); // numTables = 0
  return buf;
}

describe('importFontFromUrl', () => {
  let fs: FileSystem;
  let appService: AppService;

  beforeEach(() => {
    vi.clearAllMocks();
    const bytes = makeFontBytes();
    fs = {
      createDir: vi.fn().mockResolvedValue(undefined),
      openFile: vi.fn().mockResolvedValue({
        name: 'FangzhengSongJianKe.ttf',
        arrayBuffer: async () => bytes,
      }),
    } as unknown as FileSystem;
    appService = {
      resolveFilePath: vi.fn().mockResolvedValue('/resolved/bundle-1/FangzhengSongJianKe.ttf'),
    } as unknown as AppService;
  });

  test('downloads the font into a fresh bundle dir under Fonts and returns its info', async () => {
    const result = await importFontFromUrl(
      fs,
      appService,
      'https://mybooks.top/static/epubreader/assets/font/FangzhengSongJianKe.ttf',
      'FangzhengSongJianKe.ttf',
    );

    expect(fs.createDir).toHaveBeenCalledWith('bundle-1', 'Fonts', true);
    expect(appService.resolveFilePath).toHaveBeenCalledWith(
      'bundle-1/FangzhengSongJianKe.ttf',
      'Fonts',
    );
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        appService,
        dst: '/resolved/bundle-1/FangzhengSongJianKe.ttf',
        url: 'https://mybooks.top/static/epubreader/assets/font/FangzhengSongJianKe.ttf',
      }),
    );
    expect(fs.openFile).toHaveBeenCalledWith('bundle-1/FangzhengSongJianKe.ttf', 'Fonts');
    expect(result).not.toBeNull();
    expect(result!.path).toBe('bundle-1/FangzhengSongJianKe.ttf');
    expect(result!.bundleDir).toBe('bundle-1');
    expect(result!.byteSize).toBe(12);
    expect(result!.contentId).toBeTruthy();
  });

  test('propagates a download failure instead of writing a partial font', async () => {
    vi.mocked(downloadFile).mockRejectedValueOnce(new Error('network error'));

    await expect(
      importFontFromUrl(fs, appService, 'https://mybooks.top/x.ttf', 'x.ttf'),
    ).rejects.toThrow('network error');
    expect(fs.openFile).not.toHaveBeenCalled();
  });
});
