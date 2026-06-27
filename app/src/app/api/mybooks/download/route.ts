import { NextRequest } from 'next/server';

/**
 * MyReader 电子书下载代理
 * 用于解决跨域（CORS）问题，在 Web 平台下将文件下载请求通过本地 Node 服务转发
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Target URL not provided', { status: 400 });
  }

  try {
    console.log('[MyReader Download Proxy] fetching:', targetUrl);

    // 转发客户端请求的 Cookie 头部，以确保 MyReader 登录会话在代理请求中生效
    const cookie = request.headers.get('cookie') || '';

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Cookie: cookie,
      },
    });

    if (!res.ok) {
      return new Response(`Failed to fetch file: ${res.statusText}`, { status: res.status });
    }

    // 保留关键的响应头部
    const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = res.headers.get('Content-Length');
    const contentDisposition = res.headers.get('Content-Disposition');

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    if (contentLength) headers.set('Content-Length', contentLength);
    if (contentDisposition) headers.set('Content-Disposition', contentDisposition);

    // 允许客户端跨域（虽然本地通常是同源请求）
    headers.set('Access-Control-Allow-Origin', '*');

    // 直接流式返回数据体，避免在内存中缓存大文件
    return new Response(res.body, { headers });
  } catch (error) {
    console.error('[MyReader Download Proxy] error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
