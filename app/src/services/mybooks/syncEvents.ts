/**
 * Tauri side of the Readest Native Sync WS notification channel
 * (document/MyBooks_Sync_WS_Design.md §4). One physical connection is
 * shared across every reader instance via ref-counting — `changed` events
 * are global (`books`/`notes`/`configs` for the whole account), not scoped
 * to a single open book.
 *
 * The Web (Cloudflare Workers proxy) side is not implemented yet — Web
 * falls back to the existing REST pull-on-focus/open behavior.
 */

import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { getTauriMyBooksCookie } from './tauriCookieStore';

export interface SyncChangedEvent {
  scope: 'books' | 'notes' | 'configs';
  bookHash?: string;
  ts: number;
}

interface TauriWsMessage {
  type: 'Text' | 'Binary' | 'Ping' | 'Pong' | 'Close';
  data: unknown;
}

interface TauriWsConnection {
  send(message: string): Promise<void>;
  disconnect(): Promise<void>;
  addListener(cb: (message: TauriWsMessage) => void): Promise<() => void>;
}

const HEARTBEAT_INTERVAL_MS = 27_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let refCount = 0;
let stopped = true;
let connection: TauriWsConnection | null = null;
let removeListener: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function toWsUrl(host: string): string {
  const normalized = host.endsWith('/') ? host.slice(0, -1) : host;
  return `${normalized.replace(/^http/i, 'ws')}/api/sync/events`;
}

function clearTimers(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  heartbeatTimer = null;
  reconnectTimer = null;
}

async function teardownConnection(): Promise<void> {
  removeListener?.();
  removeListener = null;
  const current = connection;
  connection = null;
  if (current) {
    try {
      await current.disconnect();
    } catch {
      // already closed
    }
  }
}

function scheduleReconnect(): void {
  if (stopped) return;
  const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** reconnectAttempt);
  const delay = base * (0.8 + Math.random() * 0.4);
  reconnectAttempt += 1;
  console.log(
    `Native sync WS: reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})`,
  );
  reconnectTimer = setTimeout(() => {
    void connectOnce();
  }, delay);
}

function handleMessage(message: TauriWsMessage): void {
  if (message.type === 'Close') {
    console.log('Native sync WS: connection closed');
    void teardownConnection().then(() => scheduleReconnect());
    return;
  }
  if (message.type !== 'Text') return;
  try {
    const parsed = JSON.parse(message.data as string) as {
      type?: string;
    } & Partial<SyncChangedEvent>;
    if (parsed.type === 'changed') {
      eventDispatcher.dispatch('native-sync-changed', {
        scope: parsed.scope,
        bookHash: parsed.bookHash,
        ts: parsed.ts ?? Date.now(),
      } as SyncChangedEvent);
    }
  } catch {
    // ignore malformed frames
  }
}

async function connectOnce(): Promise<void> {
  if (stopped || !isTauriAppPlatform()) return;
  const host = typeof window !== 'undefined' ? localStorage.getItem('mybooks_host') : null;
  const cookie = getTauriMyBooksCookie();
  if (!host || !cookie) return;

  const url = toWsUrl(host);
  try {
    const TauriWebSocket = (await import('@tauri-apps/plugin-websocket')).default;
    const ws = (await TauriWebSocket.connect(url, {
      headers: { Cookie: cookie },
    })) as unknown as TauriWsConnection;
    connection = ws;
    reconnectAttempt = 0;
    console.log('Native sync WS: connected', url);
    removeListener = await ws.addListener(handleMessage);
    heartbeatTimer = setInterval(() => {
      ws.send('ping').catch(() => {
        // a failed heartbeat will surface as a 'Close' message shortly
      });
    }, HEARTBEAT_INTERVAL_MS);
  } catch (error) {
    console.warn('Native sync WS: connect failed', url, error);
    scheduleReconnect();
  }
}

/**
 * Mount-time hook for `useNativeSyncEvents`. Returns a release function to
 * call on unmount. Ref-counted so multiple open readers share one socket.
 */
export function acquireNativeSyncEvents(): () => void {
  refCount += 1;
  if (refCount === 1) {
    stopped = false;
    reconnectAttempt = 0;
    void connectOnce();
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      stopped = true;
      clearTimers();
      if (connection) console.log('Native sync WS: disconnecting (no more active readers)');
      void teardownConnection();
    }
  };
}
