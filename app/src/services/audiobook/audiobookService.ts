/**
 * 有声书相关 API 封装
 *
 * 复用 mybooksService.ts 的 fetchMyBooks/getBooksByType，独立成文件避免继续
 * 膨胀 mybooksService.ts。后端接口参见 document/MyBooks_WebAPI.md 3.4x /
 * webserver/handlers/audio.py：
 *   - GET /audiobooks  （即 /api/audiobooks）— 分页获取有声书列表
 *   - GET /audio/<id>  （即 /api/audio/<id>）— 获取某本书的音频/字幕文件列表
 */

import { fetchMyBooks } from '@/services/mybooksService';
import type { MyBooksBook } from '@/services/mybooksService';
import { getBooksByType } from '@/services/mybooksService';

export interface AudioTrack {
  filename: string;
  url: string;
  size: number;
  // m4b 内嵌章节时才有：同一物理文件按时间片切出的虚拟分轨。
  start_time?: number;
  end_time?: number;
  // 该曲目对应字幕资源 URL（与音频同名 .srt，m4b 章节共享同一份外挂字幕）。
  subtitle?: string;
}

export interface AudioBookDetail {
  audios: AudioTrack[];
  total_files: number;
  is_paid: boolean;
}

interface AudioBookDetailResponse {
  audios?: AudioTrack[];
  total_files?: number;
  is_paid?: boolean;
}

/**
 * 分页获取有声书列表，即后端 /api/audiobooks。
 * `type='audiobooks'` 与 getBooksByType 的通用路径（`/${type}`，start/size
 * 分页参数）完全匹配，不需要单独的请求逻辑。
 */
export async function getAudiobooks(
  page: number = 1,
  num: number = 20,
): Promise<{ books: MyBooksBook[]; total: number }> {
  return getBooksByType('audiobooks', page, num);
}

/**
 * 获取某本书的音频文件列表（含 m4b 虚拟分轨、字幕 URL）。
 */
export async function getAudioBookDetail(bookId: number): Promise<AudioBookDetail> {
  const response = await fetchMyBooks<AudioBookDetailResponse>(`/audio/${bookId}`);
  const data = response as unknown as AudioBookDetailResponse;
  return {
    audios: data.audios ?? [],
    total_files: data.total_files ?? 0,
    is_paid: data.is_paid ?? true,
  };
}
