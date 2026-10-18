import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import {
  getMyNexusAvailability,
  getMyNexusSession,
  streamMyNexusChat,
  MyBooksApiError,
} from '@/services/mybooksService';
import { useMyNexusStore } from '@/store/myNexusStore';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import type { MyBooksSysInfo } from '@/services/mybooksService';

const sseResponse = (frames: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
};

const jsonResponse = (payload: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => payload }) as unknown as Response;

const isMyBooksRequest = (url: unknown) =>
  typeof url === 'string' && url.includes('/api/mybooks/proxy/');

describe('MyNexus chat streaming', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyNexusStore.setState({ availability: {}, loading: {} });
  });

  it('parses SSE deltas, reassembles split frames and captures citations', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"He',
          'llo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}],"citations":[{"content":"cite-1"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      );
    });

    let text = '';
    let citations: { content: string }[] = [];
    let done = false;
    await streamMyNexusChat(7, [{ role: 'user', content: 'hi' }], {
      onDelta: (delta) => {
        text += delta;
      },
      onCitations: (value) => {
        citations = value;
      },
      onDone: () => {
        done = true;
      },
    });

    expect(text).toBe('Hello world');
    expect(citations).toEqual([{ content: 'cite-1' }]);
    expect(done).toBe(true);
  });

  it('throws when a frame carries an error', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(sseResponse(['data: {"error":"boom"}\n\n']));
    });

    await expect(streamMyNexusChat(7, [{ role: 'user', content: 'hi' }])).rejects.toThrow('boom');
  });

  it('surfaces a logical error from a non-2xx response', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(
        jsonResponse({ err: 'mynexus.error', msg: 'bad upstream' }, false, 502),
      );
    });

    const rejection = await streamMyNexusChat(7, [{ role: 'user', content: 'hi' }]).catch(
      (error) => error,
    );
    expect(rejection).toBeInstanceOf(MyBooksApiError);
    expect((rejection as MyBooksApiError).err).toBe('mynexus.error');
    expect((rejection as Error).message).toBe('bad upstream');
  });
});

describe('MyNexus session and availability', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyNexusStore.setState({ availability: {}, loading: {} });
  });

  it('maps the availability payload', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(jsonResponse({ err: 'ok', available: true, reading_guide: 'guide' }));
    });

    await expect(getMyNexusAvailability(3)).resolves.toEqual({
      available: true,
      readingGuide: 'guide',
    });
  });

  it('maps the session payload, keeping an empty conversation', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(jsonResponse({ err: 'ok', session_id: null, messages: [] }));
    });

    await expect(getMyNexusSession(3)).resolves.toEqual({ sessionId: null, messages: [] });
  });
});

describe('MyNexus availability gating', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mybooks_host', 'http://mybooks.local');
    vi.restoreAllMocks();
    useMyNexusStore.setState({ availability: {}, loading: {} });
  });

  it('does not probe the book when mynexus_enabled is false', async () => {
    const fetchMock = vi.fn();
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);
    useMyBooksStatusStore.setState({
      sysInfo: { mynexus_enabled: false } as MyBooksSysInfo,
    });

    await expect(useMyNexusStore.getState().loadAvailability(9)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes and caches the result when mynexus_enabled is true', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (!isMyBooksRequest(url)) return Promise.reject(new Error('unrelated fetch'));
      return Promise.resolve(jsonResponse({ err: 'ok', available: true, reading_guide: '' }));
    });
    useMyBooksStatusStore.setState({ sysInfo: { mynexus_enabled: true } as MyBooksSysInfo });

    await expect(useMyNexusStore.getState().loadAvailability(9)).resolves.toBe(true);
    expect(useMyNexusStore.getState().availability[9]?.available).toBe(true);
  });
});
