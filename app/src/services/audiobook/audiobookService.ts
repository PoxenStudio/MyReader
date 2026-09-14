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
import { isTauriAppPlatform } from '@/services/environment';

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

/**
 * 把后端返回的曲目 `url`（形如 `/api/audio/<id>/<filename>`，相对于 MyBooks
 * 主机根路径）解析成当前平台可以直接播放/下载的完整地址：
 * - Tauri：直接拼接 `mybooks_host`（Tauri 原生 WebView 加载 <audio>/下载器均
 *   可正常带上会话 Cookie，同 cloudService.ts 里封面/正文下载的处理方式）。
 * - Web：走已有的 `/api/mybooks/proxy/<path>` 通用代理（同源，自动带上
 *   Cookie，避免 CORS）。注意：该通用代理目前不转发 Range 请求/响应头，
 *   因此"在线流式播放时拖动到尚未缓冲的位置"在浏览器端体验会打折扣——这不
 *   影响已下载到本地离线播放的场景，仅影响在线试听的拖动体验，本期先接受
 *   这个已知限制。
 * 没有配置 `mybooks_host`（理论上不会发生，音频功能本身依赖已登录的
 * MyBooks 连接）时原样返回，交给调用方兜底。
 */
export function resolveAudioTrackUrl(url: string): string {
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;
  if (!host) return url;
  const normalizedHost = host.endsWith('/') ? host.slice(0, -1) : host;

  if (isTauriAppPlatform()) {
    return url.startsWith('http')
      ? url
      : `${normalizedHost}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  const apiPath = url.replace(/^\/?api\//, '');
  return `/api/mybooks/proxy/${apiPath}?host=${encodeURIComponent(host)}`;
}
