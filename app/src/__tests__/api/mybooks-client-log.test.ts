import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/mybooks/client-log/route';

describe('/api/mybooks/client-log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the reported message to the server console and returns 204', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const request = new NextRequest('http://localhost:3000/api/mybooks/client-log', {
      method: 'POST',
      body: JSON.stringify({ bookHash: 'cloud-42-epub', message: 'Book not found' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[embed-client]'),
      expect.stringContaining('cloud-42-epub'),
      expect.stringContaining('Book not found'),
    );
  });

  it('returns 400 without logging when the body has no message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const request = new NextRequest('http://localhost:3000/api/mybooks/client-log', {
      method: 'POST',
      body: JSON.stringify({ bookHash: 'cloud-42-epub' }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('truncates an overlong message instead of flooding the log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const longMessage = 'x'.repeat(5000);

    const request = new NextRequest('http://localhost:3000/api/mybooks/client-log', {
      method: 'POST',
      body: JSON.stringify({ message: longMessage }),
    });
    const response = await POST(request);

    expect(response.status).toBe(204);
    const loggedMessage = errorSpy.mock.calls[0]?.[2] as string;
    expect(loggedMessage.length).toBeLessThan(longMessage.length);
  });
});
