import { NextRequest } from 'next/server';

const avatarCache = new Map<string, { contentType: string; data: ArrayBuffer }>();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const url = new URL(request.url);
  const { path } = await params;
  const avatarPath = path.join('/');

  const mybooksHost = url.searchParams.get('host');

  if (!mybooksHost) {
    return new Response('MyReader host not provided', { status: 400 });
  }

  if (!avatarPath) {
    return new Response('Avatar path not provided', { status: 400 });
  }

  const normalizedHost = mybooksHost.endsWith('/') ? mybooksHost.slice(0, -1) : mybooksHost;
  const avatarUrl = `${normalizedHost}/${avatarPath}`;

  try {
    const response = await fetch(avatarUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/*',
        Cookie: request.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const cached = avatarCache.get(avatarUrl);
      if (cached) {
        return new Response(cached.data, {
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
      return new Response('Failed to fetch avatar', { status: response.status });
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.startsWith('image/')) {
      return new Response('Invalid avatar response', { status: 502 });
    }

    const data = await response.arrayBuffer();
    avatarCache.set(avatarUrl, { contentType, data });

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching avatar:', error);
    const cached = avatarCache.get(avatarUrl);
    if (cached) {
      return new Response(cached.data, {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }
    return new Response('Failed to fetch avatar', { status: 500 });
  }
}
