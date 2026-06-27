import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());
const mockTxtConvert = vi.hoisted(() => vi.fn());

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return { ...actual, partialMD5: mockPartialMD5 };
});

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  class MockDocumentLoader {
    open() {
      return mockOpen();
    }
  }
  return { ...actual, DocumentLoader: MockDocumentLoader };
});

vi.mock('@/utils/txt', () => ({
  TxtToEpubConverter: class {
    convert(options: { file: File }) {
      return mockTxtConvert(options);
    }
  },
}));
vi.mock('@/utils/svg', () => ({ svg2png: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
}));

import { BaseAppService } from '@/services/appService';

class TestAppService extends BaseAppService {
  protected fs = {
    openFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(),
    stats: vi.fn(),
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn().mockResolvedValue(''),
    getImageURL: vi.fn(),
    getPrefix: vi.fn(),
  };

  protected resolvePath() {
    return { baseDir: 0, basePrefix: async () => '', fp: '', base: 'Books' as const };
  }

  async init() {}
  async setCustomRootDir() {}
  async selectDirectory() {
    return '';
  }
  async selectFiles() {
    return [];
  }
  async saveFile() {
    return false;
  }
  async ask() {
    return false;
  }
  async openDatabase() {
    return {} as ReturnType<BaseAppService['openDatabase']>;
  }
  async createWindow() {}
  async getCacheDir() {
    return '';
  }
  async clearWebviewCache() {}
  async showNotification() {}

  getFs() {
    return this.fs;
  }
}

describe('importBook TXT to EPUB conversion records sourceFormat', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue('txt-hash-123');
  });

  it('sets format to EPUB but keeps sourceFormat as TXT', async () => {
    const epubFile = new File(['<epub bytes>'], 'My Book.epub');
    mockTxtConvert.mockResolvedValue({
      file: epubFile,
      bookTitle: 'My Book',
      chapterCount: 1,
      language: 'en',
    });
    mockOpen.mockResolvedValue({
      book: {
        metadata: { title: 'My Book', author: 'Someone', language: 'en' },
        getCover: vi.fn().mockResolvedValue(null),
      },
      format: 'EPUB',
    });

    const txtFile = new File(['raw txt content'], 'My Book.txt', { type: 'text/plain' });
    const books: Book[] = [];
    const result = await service.importBook(txtFile, books);

    expect(mockTxtConvert).toHaveBeenCalledTimes(1);
    expect(result!.format).toBe('EPUB');
    expect(result!.sourceFormat).toBe('TXT');
  });

  it('does not set sourceFormat for a non-TXT import', async () => {
    mockOpen.mockResolvedValue({
      book: {
        metadata: { title: 'My Book', author: 'Someone', language: 'en' },
        getCover: vi.fn().mockResolvedValue(null),
      },
      format: 'EPUB',
    });

    const epubFile = new File(['<epub bytes>'], 'My Book.epub', {
      type: 'application/epub+zip',
    });
    const books: Book[] = [];
    const result = await service.importBook(epubFile, books);

    expect(mockTxtConvert).not.toHaveBeenCalled();
    expect(result!.format).toBe('EPUB');
    expect(result!.sourceFormat).toBeUndefined();
  });
});
