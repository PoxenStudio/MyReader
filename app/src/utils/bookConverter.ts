/**
 * MyReader 书籍数据转换工具
 * 将 MyReader API 返回的数据转换为本地 Book 类型
 */

import { Book, BookFormat, ReadingStatus } from '@/types/book';
import type { MyBooksBook } from '@/services/mybooksService';

/**
 * 构建封面图片的代理路径
 * 使用本地代理路由来解决跨域问题
 * @param path - 图片路径（thumb 或 img）
 * @returns 代理路径
 */
function buildCoverProxyPath(path: string): string {
  // 检查 path 是否已经是完整 URL
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // 如果 path 以 / 开头，移除开头的 /
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `/api/mybooks/cover/${normalizedPath}`;
}

/**
 * 将 MyReader 格式转换为 BookFormat
 */
function mapFormat(format: string): BookFormat {
  const formatMap: Record<string, BookFormat> = {
    epub: 'EPUB',
    pdf: 'PDF',
    mobi: 'MOBI',
    azw: 'AZW',
    azw3: 'AZW3',
    cbz: 'CBZ',
    fb2: 'FB2',
    txt: 'TXT',
    md: 'MD',
  };
  return formatMap[format.toLowerCase()] || 'EPUB';
}

/**
 * 将 MyReader 阅读状态转换为本地 ReadingStatus
 */
function mapReadingStatus(state: number): ReadingStatus {
  switch (state) {
    case 0:
      return 'unread';
    case 1:
      return 'reading';
    case 2:
      return 'finished';
    default:
      return 'unread';
  }
}

/**
 * 获取书籍的主要格式
 */
function getPrimaryFormat(files: Array<{ format: string; size: number }>): BookFormat {
  if (!files || files.length === 0) {
    return 'EPUB';
  }
  // 默认阅读格式优先级：epub > azw3 > mobi > pdf > txt，其余格式作为兜底
  const preferredFormats = ['epub', 'azw3', 'mobi', 'pdf', 'txt', 'cbz', 'fb2', 'md'];

  for (const pref of preferredFormats) {
    const file = files.find((f) => f.format.toLowerCase() === pref);
    if (file) {
      return mapFormat(pref);
    }
  }

  if (files.length > 0) {
    return mapFormat((files[0] as { format: string }).format);
  }

  return 'EPUB';
}

/**
 * 将 MyBooksBook 转换为本地 Book 类型
 * @param cloudBook - MyReader API 返回的书籍对象
 * @returns 本地 Book 类型对象
 */
export function convertMyBooksToLocalBook(cloudBook: MyBooksBook): Book {
  const now = Date.now();

  // 获取封面图片 URL，优先使用 thumb，然后使用 img
  let coverImageUrl: string | null = null;
  let originCoverUrl: string | null = null;
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;

  if (host) {
    // 对 host 进行编码，作为查询参数传递给代理
    const encodedHost = encodeURIComponent(host);

    // 优先使用 thumb
    if (cloudBook.thumb && cloudBook.thumb.trim()) {
      const coverPath = buildCoverProxyPath(cloudBook.thumb);
      const separator = coverPath.includes('?') ? '&' : '?';
      coverImageUrl = `${coverPath}${separator}host=${encodedHost}`;
    } else if (cloudBook.img && cloudBook.img.trim()) {
      const coverPath = buildCoverProxyPath(cloudBook.img);
      const separator = coverPath.includes('?') ? '&' : '?';
      coverImageUrl = `${coverPath}${separator}host=${encodedHost}`;
    }

    const coverPath = buildCoverProxyPath(cloudBook.img);
    const separator = coverPath.includes('?') ? '&' : '?';
    originCoverUrl = `${coverPath}${separator}host=${encodedHost}`;
  }

  const format = getPrimaryFormat(cloudBook.files || []);

  return {
    // 使用 cloud-<id>-<format> 区分云端书籍的每个格式，使其在本地拥有独立的目录/进度
    hash: buildCloudBookHash(cloudBook.id, format),
    // 记录该书在 MyBooks 服务端的 id，供下载后追溯来源
    bookId: cloudBook.id,
    // 云端书籍通过在线阅读 URL 访问
    url: `/read/${cloudBook.id}`,
    format,
    // Record the original mybooks format explicitly so the format badge stays
    // correct even if downloadMyBooksBook silently converts the file on disk
    // (e.g. TXT -> EPUB, see cloudService.ts).
    sourceFormat: format,
    title: cloudBook.title,
    author: cloudBook.author,
    tags: cloudBook.tags || [],
    coverImageUrl,
    // 使用当前时间作为创建和更新时间
    createdAt: now,
    updatedAt: now,
    // 阅读状态
    readingStatus: mapReadingStatus(cloudBook.state?.read_state || 0),
    // 存储类型：云端书籍
    storageType: 'cloud',
    // 保存书籍文件列表以供下载时使用
    files: cloudBook.files?.map((file) => ({
      format: mapFormat(file.format),
      size: file.size,
      href: file.href || `/api/book/${cloudBook.id}.${file.format.toUpperCase()}`,
    })),
    originCoverUrl,
  };
}

/**
 * 批量转换 MyReader 书籍列表
 * @param cloudBooks - MyReader API 返回的书籍列表
 * @returns 本地 Book 类型数组
 */
export function convertMyBooksToLocalBooks(cloudBooks: MyBooksBook[]): Book[] {
  return cloudBooks.map(convertMyBooksToLocalBook);
}

/**
 * 判断书籍是否为云端书籍
 * @param book - 书籍对象
 * @returns 是否为云端书籍
 */
export function isCloudBook(book: Book): boolean {
  return book.storageType === 'cloud' || book.hash.startsWith('cloud-');
}

/**
 * 检查云端书籍是否在本地有相同 title 和 author 的副本
 * @param cloudBook - 云端书籍对象
 * @param localBooks - 本地书籍列表
 * @returns 是否有本地副本
 */
export function hasLocalCopy(cloudBook: Book, localBooks: Book[]): boolean {
  if (!isCloudBook(cloudBook)) {
    return false;
  }
  return localBooks.some(
    (localBook) =>
      !isCloudBook(localBook) &&
      localBook.title === cloudBook.title &&
      localBook.author === cloudBook.author,
  );
}

/**
 * 从云端书籍的 hash 中提取原始 ID
 * 兼容带格式后缀（cloud-<id>-<format>）和不带格式后缀（cloud-<id>）两种形式
 * @param hash - 书籍 hash
 * @returns 原始 MyReader ID，如果不是云端书籍则返回 null
 */
export function getCloudBookId(hash: string): number | null {
  const match = hash.match(/^cloud-(\d+)/);
  if (!match) {
    return null;
  }
  return parseInt(match[1]!, 10);
}

/**
 * 解析书籍在 MyBooks 服务端对应的 id
 * 优先使用 book.bookId，否则回退解析 cloud-<id>-<format> 形式的 hash
 * （兼容在 bookId 字段引入之前下载的云端书籍）
 * @param book - 书籍对象
 * @returns MyBooks 服务端 id，不存在则返回 0
 */
export function getMyBooksId(book: Book): number {
  if (book.bookId) return book.bookId;
  return getCloudBookId(book.hash) || 0;
}

/**
 * 构建云端书籍某个格式对应的本地 hash，使每个格式拥有独立的本地目录/进度
 * @param id - 云端书籍 ID
 * @param format - 目标格式
 * @returns hash，形如 cloud-<id>-<format>
 */
export function buildCloudBookHash(id: number, format: BookFormat): string {
  return `cloud-${id}-${format.toLowerCase()}`;
}

/**
 * 基于一本云端书籍的某个格式记录，构造同一本书在另一格式下的本地 Book 记录
 * 新记录拥有独立的 hash/目录，不携带原记录的下载状态和阅读进度
 * @param book - 已有的云端书籍 Book 记录（任意格式）
 * @param format - 目标格式
 * @returns 新的 Book 记录；若不是云端书籍或目标格式不可用则返回 null
 */
export function getFormatVariantBook(book: Book, format: BookFormat): Book | null {
  const id = getCloudBookId(book.hash);
  if (id === null) {
    return null;
  }
  const file = book.files?.find((f) => f.format === format);
  if (!file) {
    return null;
  }
  const now = Date.now();
  return {
    ...book,
    hash: buildCloudBookHash(id, format),
    format,
    sourceFormat: format,
    createdAt: now,
    updatedAt: now,
    downloadedAt: undefined,
    coverDownloadedAt: undefined,
    progress: undefined,
    readingStatus: undefined,
  };
}
