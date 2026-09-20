import { describe, expect, it } from 'vitest';
import { convertMyBooksToLocalBook, getMyBooksId } from '@/utils/bookConverter';
import type { MyBooksBook } from '@/services/mybooksService';

// /api/audiobooks omits files[].href and per-user state.
const audiobookApiItem = (): MyBooksBook =>
  ({
    id: 123,
    title: 'Dune',
    rating: 0,
    timestamp: '2024-01-01',
    pubdate: '2024-01-01',
    author: 'Frank Herbert',
    authors: ['Frank Herbert'],
    author_sort: 'Herbert, Frank',
    tag: '',
    tags: [],
    publisher: '',
    comments: '',
    series: '',
    series_index: 0,
    languages: [],
    isbn: '',
    img: 'https://mybooks.local/get/cover/123.jpg?t=1',
    thumb: 'https://mybooks.local/get/thumb_240_320/123.jpg?t=1',
    collector: '',
    count_visit: 0,
    count_download: 0,
    sole: false,
    has_audio: 1,
    book_type: 0,
    book_count: 1,
    state: undefined as unknown as MyBooksBook['state'],
    category: '',
    ext_link: '',
    files: [{ format: 'epub', size: 0 } as unknown as MyBooksBook['files'][number]],
    dynamic_cover: 0,
  }) as MyBooksBook;

describe('audiobook shelf item conversion (diagnosis)', () => {
  it('resolves a non-zero bookId via getMyBooksId', () => {
    const book = convertMyBooksToLocalBook(audiobookApiItem());
    expect(book.bookId).toBe(123);
    expect(getMyBooksId(book)).toBe(123);
  });

  it('does not crash when state is missing', () => {
    expect(() => convertMyBooksToLocalBook(audiobookApiItem())).not.toThrow();
  });

  it('resolves a format even with a hrefless file entry', () => {
    const book = convertMyBooksToLocalBook(audiobookApiItem());
    expect(book.format).toBe('EPUB');
    expect(book.files?.[0]?.href).toBeTruthy();
  });
});
