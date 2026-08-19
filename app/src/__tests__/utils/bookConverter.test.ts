import { describe, test, expect } from 'vitest';
import {
  buildCloudBookHash,
  convertMyBooksToLocalBook,
  getCloudBookId,
  getFormatVariantBook,
  mergeUniqueBooksByHash,
  resolveCloudBooksPageAppend,
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

describe('metadata and rating conversion via convertMyBooksToLocalBook', () => {
  test('maps publisher, pubdate, comments and series into book.metadata', () => {
    const cloudBook = createMyBooksBook({
      publisher: '重庆出版社',
      pubdate: '2024-01-01',
      comments: '书籍内容简介',
      series: '三体系列',
      series_index: 1,
      languages: ['zho'],
    });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.metadata?.publisher).toBe('重庆出版社');
    expect(book.metadata?.published).toBe('2024-01-01');
    expect(book.metadata?.description).toBe('书籍内容简介');
    expect(book.metadata?.series).toBe('三体系列');
    expect(book.metadata?.seriesIndex).toBe(1);
  });

  test('maps rating from MyBooksBook', () => {
    const cloudBook = createMyBooksBook({ rating: 8 });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.rating).toBe(8);
  });

  test('leaves rating undefined when MyBooksBook rating is 0', () => {
    const cloudBook = createMyBooksBook({ rating: 0 });
    const book = convertMyBooksToLocalBook(cloudBook);
    expect(book.rating).toBeUndefined();
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

describe('mergeUniqueBooksByHash', () => {
  const makeBook = (hash: string): Book => ({
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    storageType: 'cloud',
  });

  test('appends incoming books that are not already present', () => {
    const prev = [makeBook('cloud-1-epub'), makeBook('cloud-2-epub')];
    const incoming = [makeBook('cloud-3-epub')];
    const merged = mergeUniqueBooksByHash(prev, incoming);
    expect(merged.map((b) => b.hash)).toEqual(['cloud-1-epub', 'cloud-2-epub', 'cloud-3-epub']);
  });

  // Reproduces the "Load More" duplicate-key bug: the same page gets fetched
  // twice (e.g. a re-run effect or a double-invoked Strict Mode effect) and
  // append naively concatenates, producing duplicate hashes/React keys.
  test('drops incoming books whose hash already exists in prev', () => {
    const prev = [makeBook('cloud-1-epub'), makeBook('cloud-2-epub')];
    const incoming = [makeBook('cloud-2-epub'), makeBook('cloud-3-epub')];
    const merged = mergeUniqueBooksByHash(prev, incoming);
    expect(merged.map((b) => b.hash)).toEqual(['cloud-1-epub', 'cloud-2-epub', 'cloud-3-epub']);
  });

  test('does not mutate the prev array', () => {
    const prev = [makeBook('cloud-1-epub')];
    mergeUniqueBooksByHash(prev, [makeBook('cloud-2-epub')]);
    expect(prev.map((b) => b.hash)).toEqual(['cloud-1-epub']);
  });
});

describe('resolveCloudBooksPageAppend', () => {
  const makeBook = (hash: string): Book => ({
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    storageType: 'cloud',
  });

  test('appends a non-empty page within the reported total and leaves total unchanged (null)', () => {
    const prev = [makeBook('cloud-1-epub')];
    const incoming = [makeBook('cloud-2-epub')];
    const result = resolveCloudBooksPageAppend(prev, incoming, 5);
    expect(result.books.map((b) => b.hash)).toEqual(['cloud-1-epub', 'cloud-2-epub']);
    expect(result.total).toBeNull();
  });

  // MyBooks can report a `total` larger than what a listing actually has
  // (observed for the "reading" status filter) — once a "load more" page
  // comes back empty there's nothing left, so the total must be corrected
  // down to what was actually loaded instead of trusting the server's count.
  test('an empty page corrects total to the number of books already loaded, leaving books untouched', () => {
    const prev = [makeBook('cloud-1-epub'), makeBook('cloud-2-epub')];
    const result = resolveCloudBooksPageAppend(prev, [], 10);
    expect(result.books).toBe(prev);
    expect(result.total).toBe(2);
  });

  test('dedupes an incoming page that repeats an already-loaded book', () => {
    const prev = [makeBook('cloud-1-epub'), makeBook('cloud-2-epub')];
    const incoming = [makeBook('cloud-2-epub'), makeBook('cloud-3-epub')];
    const result = resolveCloudBooksPageAppend(prev, incoming, 3);
    expect(result.books.map((b) => b.hash)).toEqual([
      'cloud-1-epub',
      'cloud-2-epub',
      'cloud-3-epub',
    ]);
    expect(result.total).toBeNull();
  });

  // MyBooks can also report a `total` smaller than what it actually returns
  // across pages — the loaded count overtaking the reported total means the
  // total was an undercount, so it must be corrected up to match reality
  // instead of hiding a Load More tile that still has more data behind it,
  // or showing a nonsensical "3/2" count.
  test('a page that pushes the loaded count past the reported total corrects total upward', () => {
    const prev = [makeBook('cloud-1-epub'), makeBook('cloud-2-epub')];
    const incoming = [makeBook('cloud-3-epub')];
    const result = resolveCloudBooksPageAppend(prev, incoming, 2);
    expect(result.books.map((b) => b.hash)).toEqual([
      'cloud-1-epub',
      'cloud-2-epub',
      'cloud-3-epub',
    ]);
    expect(result.total).toBe(3);
  });

  test('a page that exactly meets the reported total leaves it unchanged (null)', () => {
    const prev = [makeBook('cloud-1-epub')];
    const incoming = [makeBook('cloud-2-epub')];
    const result = resolveCloudBooksPageAppend(prev, incoming, 2);
    expect(result.total).toBeNull();
  });
});
