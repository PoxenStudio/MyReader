import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/mybooks/avatar/[...path]/route';

describe('/api/mybooks/avatar/[...path]', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not let Next.js persist a bad upstream response across requests', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not an image', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const request = new NextRequest(
      'http://localhost:3000/api/mybooks/avatar/avatar/1.png?host=http%3A%2F%2F127.0.0.1%3A8082',
    );
    const response = await GET(request, { params: Promise.resolve({ path: ['avatar', '1.png'] }) });

    expect(response.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8082/avatar/1.png',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('serves the last successfully fetched avatar when the upstream server is unavailable', async () => {
    const imageBytes = 'fake-image-bytes';

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(imageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );

    const makeRequest = () =>
      new NextRequest(
        'http://localhost:3000/api/mybooks/avatar/avatar/2.png?host=http%3A%2F%2F127.0.0.1%3A8082',
      );

    const firstResponse = await GET(makeRequest(), {
      params: Promise.resolve({ path: ['avatar', '2.png'] }),
    });
    expect(firstResponse.status).toBe(200);
    expect(await firstResponse.text()).toBe(imageBytes);

    fetchSpy.mockRejectedValueOnce(new Error('fetch failed'));

    const secondResponse = await GET(makeRequest(), {
      params: Promise.resolve({ path: ['avatar', '2.png'] }),
    });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get('Content-Type')).toBe('image/png');
    expect(await secondResponse.text()).toBe(imageBytes);
  });
});
