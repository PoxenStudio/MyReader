/**
 * MyReader 封面图片代理
 * 用于解决跨域问题，将前端请求转发到 MyReader 服务器
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').slice(5); // /api/mybooks/cover/ 之后的部分
  const coverPath = pathParts.join('/');

  // 从查询参数获取 mybooks host
  const mybooksHost = url.searchParams.get('host');

  if (!mybooksHost) {
    return new Response('MyReader host not provided', { status: 400 });
  }

  if (!coverPath) {
    return new Response('Cover path not provided', { status: 400 });
  }

  try {
    // 构建目标 URL
    const normalizedHost = mybooksHost.endsWith('/') ? mybooksHost.slice(0, -1) : mybooksHost;
    const coverUrl = coverPath.startsWith('/')
      ? `${normalizedHost}${coverPath}`
      : `${normalizedHost}/get/${coverPath}`;

    // 转发请求到 MyReader 服务器
    const response = await fetch(coverUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/*',
      },
      cache: 'force-cache',
    });

    if (!response.ok) {
      return new Response('Failed to fetch cover image', { status: response.status });
    }

    // 获取响应头中的 Content-Type
    const contentType = response.headers.get('Content-Type') || 'image/jpeg';

    // 返回图片数据
    const blob = await response.blob();
    return new Response(blob, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // 缓存一天
      },
    });
  } catch (error) {
    console.error('Error fetching cover image:', error);
    return new Response('Failed to fetch cover image', { status: 500 });
  }
}
