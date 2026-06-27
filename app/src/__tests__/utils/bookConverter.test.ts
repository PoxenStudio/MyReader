import { describe, test, expect } from 'vitest';
import {
  buildCloudBookHash,
  convertMyBooksToLocalBook,
  getCloudBookId,
  getFormatVariantBook,
} from '@/utils/bookConverter';
import type { MyBooksBook } from '@/services/mybooksService';
import { Book } from '@/types/book';

function createMyBooksBook(overrides: Partial<MyBooksBook> = {}): MyBooksBook {
  return {
    id: 123,
    title: 'Test Book',
    rating: 0,
    timestamp: '',
    pubdate: '',
    author: 'Author',
    authors: ['Author'],
    author_sort: '',
    tag: '',
    tags: [],
    publisher: '',
    comments: '',
    series: '',
    series_index: 0,
    languages: [],
    isbn: '',
    img: '',
    thumb: '',
    collector: '',
    count_visit: 0,
    count_download: 0,
    sole: false,
    has_audio: 0,
    book_type: 0,
    book_count: 0,
    state: {
      favorite: 0,
      favorite_date: null,
      wants: 0,
      wants_date: null,
      read_state: 0,
      read_date: null,
      online_read: 0,
      download: 0,
    },
    category: '',
    ext_link: '',
    files: [],
    dynamic_cover: 0,
    ...overrides,
  };
}

describe('getPrimaryFormat priority via convertMyBooksToLocalBook', () => {
  test('prefers epub over azw3, mobi, pdf, txt', () => {
    const cloudBook = createMyBooksBook({
      files: [
        { format: 'pdf', size: 1, href: '/f.pdf' },
        { format: 'epub', size: 1, href: '/f.epub' },
        { format: 'mobi', size: 1, href: '/f.mobi' },
      ],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.format).toBe('EPUB');
    expect(book.hash).toBe('cloud-123-epub');
    expect(book.sourceFormat).toBe('EPUB');
  });

  test('falls back to azw3 when epub is missing', () => {
    const cloudBook = createMyBooksBook({
      files: [
        { format: 'pdf', size: 1, href: '/f.pdf' },
        { format: 'azw3', size: 1, href: '/f.azw3' },
        { format: 'mobi', size: 1, href: '/f.mobi' },
      ],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.format).toBe('AZW3');
    expect(book.hash).toBe('cloud-123-azw3');
  });

  test('prefers mobi over pdf and txt', () => {
    const cloudBook = createMyBooksBook({
      files: [
        { format: 'txt', size: 1, href: '/f.txt' },
        { format: 'pdf', size: 1, href: '/f.pdf' },
        { format: 'mobi', size: 1, href: '/f.mobi' },
      ],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.format).toBe('MOBI');
    expect(book.hash).toBe('cloud-123-mobi');
  });

  test('prefers pdf over txt', () => {
    const cloudBook = createMyBooksBook({
      files: [
        { format: 'txt', size: 1, href: '/f.txt' },
        { format: 'pdf', size: 1, href: '/f.pdf' },
      ],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.format).toBe('PDF');
    expect(book.hash).toBe('cloud-123-pdf');
  });

  test('records sourceFormat as TXT when txt is the only available format', () => {
    const cloudBook = createMyBooksBook({
      files: [{ format: 'txt', size: 1, href: '/f.txt' }],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.format).toBe('TXT');
    expect(book.sourceFormat).toBe('TXT');
  });

  test('records bookId from the MyBooks remote id', () => {
    const cloudBook = createMyBooksBook({ id: 456 });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.bookId).toBe(456);
  });
});

describe('getCloudBookId', () => {
  test('parses id from hash with format suffix', () => {
    expect(getCloudBookId('cloud-123-epub')).toBe(123);
  });

  test('parses id from hash without format suffix', () => {
    expect(getCloudBookId('cloud-123')).toBe(123);
  });

  test('returns null for non-cloud hash', () => {
    expect(getCloudBookId('abcdef123456')).toBeNull();
  });
});

describe('buildCloudBookHash', () => {
  test('builds a lowercase format-suffixed hash', () => {
    expect(buildCloudBookHash(123, 'EPUB')).toBe('cloud-123-epub');
    expect(buildCloudBookHash(123, 'AZW3')).toBe('cloud-123-azw3');
  });
});

describe('getFormatVariantBook', () => {
  const baseBook: Book = {
    hash: 'cloud-123-epub',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    storageType: 'cloud',
    downloadedAt: 2000,
    coverDownloadedAt: 2000,
    progress: [1, 10],
    readingStatus: 'reading',
    files: [
      { format: 'EPUB', size: 1, href: '/f.epub' },
      { format: 'PDF', size: 2, href: '/f.pdf' },
    ],
  };

  test('builds a new variant with format-specific hash and cleared local state', () => {
    const variant = getFormatVariantBook(baseBook, 'PDF');
    expect(variant).not.toBeNull();
    expect(variant!.hash).toBe('cloud-123-pdf');
    expect(variant!.format).toBe('PDF');
    expect(variant!.sourceFormat).toBe('PDF');
    expect(variant!.downloadedAt).toBeUndefined();
    expect(variant!.coverDownloadedAt).toBeUndefined();
    expect(variant!.progress).toBeUndefined();
    expect(variant!.readingStatus).toBeUndefined();
    expect(variant!.title).toBe('Test Book');
  });

  test('does not mutate the original book', () => {
    getFormatVariantBook(baseBook, 'PDF');
    expect(baseBook.hash).toBe('cloud-123-epub');
    expect(baseBook.format).toBe('EPUB');
    expect(baseBook.downloadedAt).toBe(2000);
  });

  test('returns null when the requested format is not available', () => {
    expect(getFormatVariantBook(baseBook, 'MOBI')).toBeNull();
  });

  test('returns null when the book is not a cloud book', () => {
    const localBook: Book = { ...baseBook, hash: 'localhash123' };
    expect(getFormatVariantBook(localBook, 'PDF')).toBeNull();
  });
});
