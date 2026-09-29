import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * plugin-http fetch that forwards `signal` only until the response arrives.
 * The plugin cancels through the signal even after the request finished, and that
 * IPC call rejects unhandled ("resource id … is invalid") when the popup closes.
 */
export const fetchWithAbort = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const { signal, ...rest } = init;
  const inner = new AbortController();
  const forward = () => inner.abort();
  if (signal?.aborted) inner.abort();
  signal?.addEventListener('abort', forward);
  try {
    return await tauriFetch(url, { ...rest, signal: inner.signal });
  } finally {
    signal?.removeEventListener('abort', forward);
  }
};
