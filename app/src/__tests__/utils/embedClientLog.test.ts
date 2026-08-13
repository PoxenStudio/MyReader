import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { setEmbedReturnUrl } from '@/utils/embedReturn';
import { reportEmbedError } from '@/utils/embedClientLog';

describe('reportEmbedError', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('relays the error to the server log for a book opened via the embedded flow', () => {
    setEmbedReturnUrl('cloud-42-epub', '/book/42');
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    reportEmbedError('cloud-42-epub', 'Book not found');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/mybooks/client-log',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ bookHash: 'cloud-42-epub', message: 'Book not found' }),
      }),
    );
  });

  test('does nothing for a book not opened via the embedded flow', () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    reportEmbedError('local-book-hash', 'Book not found');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
