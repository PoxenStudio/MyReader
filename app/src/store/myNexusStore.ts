import { create } from 'zustand';
import {
  getMyNexusAvailability,
  getMyNexusSession,
  streamMyNexusChat,
  MyNexusChatMessage,
} from '@/services/mybooksService';
import { useMyBooksStatusStore } from '@/store/mybooksStatusStore';
import { stubTranslation as _ } from '@/utils/misc';

// How long a probed per-book availability stays valid before re-checking.
const AVAILABILITY_TTL_MS = 5 * 60 * 1000;

interface MyNexusAvailabilityEntry {
  available: boolean;
  fetchedAt: number;
}

export interface MyNexusMessage extends MyNexusChatMessage {
  mindmap?: { title: string; markdown: string };
  createdAt?: number;
}

interface MyNexusSession {
  messages: MyNexusMessage[];
  loading: boolean;
  error: string;
  initialized: boolean;
}

// Stable empty session so a panel without a book doesn't rerender on every read.
export const EMPTY_MYNEXUS_SESSION: MyNexusSession = {
  messages: [],
  loading: false,
  error: '',
  initialized: false,
};

interface MyNexusState {
  availability: Record<number, MyNexusAvailabilityEntry>;
  loading: Record<number, boolean>;
  sessions: Record<number, MyNexusSession>;
  loadAvailability: (bookId: number, force?: boolean) => Promise<boolean>;
  ensureSession: (bookId: number, bookTitle?: string) => Promise<void>;
  send: (bookId: number, text: string) => Promise<void>;
}

// Chat state lives in the store, not the panel: hiding the notebook unmounts
// the panel, so an in-flight answer must keep streaming into a surviving place.
const mergeSession = (state: MyNexusState, bookId: number, patch: Partial<MyNexusSession>) => ({
  sessions: {
    ...state.sessions,
    [bookId]: { ...(state.sessions[bookId] ?? EMPTY_MYNEXUS_SESSION), ...patch },
  },
});

const updateLastAssistant = (
  state: MyNexusState,
  bookId: number,
  update: (message: MyNexusMessage) => MyNexusMessage,
) => {
  const session = state.sessions[bookId] ?? EMPTY_MYNEXUS_SESSION;
  const messages = [...session.messages];
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return mergeSession(state, bookId, {});
  messages[messages.length - 1] = update(last);
  return mergeSession(state, bookId, { messages });
};

const parseMindmapFrame = (
  bookId: number,
  toolName?: string,
  resultJson?: string,
): { title: string; markdown: string } | null => {
  if (toolName !== 'generate_mindmap' || !resultJson) return null;
  let parsed: { title?: string; markdown?: string; stats?: { node_count?: number } };
  try {
    parsed = JSON.parse(resultJson);
  } catch (e) {
    console.error(
      `[MyNexus] mindmap result_json parse failed book=${bookId}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
  const markdown = parsed.markdown || '';
  if (!markdown) {
    console.warn(`[MyNexus] mindmap has no markdown book=${bookId}`);
    return null;
  }
  console.log(
    `[MyNexus] mindmap parsed book=${bookId} nodes=${parsed.stats?.node_count ?? 0} length=${markdown.length}`,
  );
  return { title: parsed.title || '', markdown };
};

// Persisted history carries tool_results, so replay those into the rendered shape.
const applyMindmaps = (bookId: number, messages: MyNexusMessage[]): MyNexusMessage[] =>
  messages.map((message) => {
    if (message.role !== 'assistant' || message.mindmap) return message;
    const mindmap = parseMindmapFrame(
      bookId,
      message.toolResult?.toolName,
      message.toolResult?.resultJson,
    );
    return mindmap ? { ...message, mindmap } : message;
  });

// Whether the site has MyNexus on at all; the per-book probe is gated on this.
export const useMyNexusEnabled = (): boolean =>
  useMyBooksStatusStore((state) => state.sysInfo?.mynexus_enabled === true);

export const useMyNexusAvailability = (bookId: number | undefined): boolean => {
  const available = useMyNexusStore((state) => (bookId ? state.availability[bookId] : undefined));
  return available?.available === true;
};

export const useMyNexusStore = create<MyNexusState>((set, get) => ({
  availability: {},
  loading: {},
  sessions: {},

  loadAvailability: async (bookId, force = false) => {
    if (!bookId) return false;
    const status = useMyBooksStatusStore.getState();
    if (status.sysInfo?.mynexus_enabled !== true) return false;
    // MyBooks is unreachable: skip the probe (the answer is a foregone "no")
    // and save the request until the connection recovers.
    if (status.isOffline) {
      console.log(`[MyNexus] skipping availability probe for book ${bookId}: MyBooks offline`);
      return false;
    }

    const entry = get().availability[bookId];
    if (!force && entry && Date.now() - entry.fetchedAt < AVAILABILITY_TTL_MS) {
      return entry.available;
    }
    if (get().loading[bookId]) return entry?.available ?? false;

    set((state) => ({ loading: { ...state.loading, [bookId]: true } }));
    try {
      const { available } = await getMyNexusAvailability(bookId);
      console.log(`[MyNexus] availability for book ${bookId}: ${available}`);
      set((state) => ({
        availability: { ...state.availability, [bookId]: { available, fetchedAt: Date.now() } },
      }));
      return available;
    } catch (error) {
      // Unreachable or rejected: treated as unusable, and deliberately left
      // uncached so the next probe can retry as soon as MyBooks is back.
      console.error(
        `[MyNexus] availability probe for book ${bookId} failed:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    } finally {
      set((state) => ({ loading: { ...state.loading, [bookId]: false } }));
    }
  },

  ensureSession: async (bookId, bookTitle) => {
    if (!bookId) return;
    // Already loaded (or loading) — a remount must not wipe an in-flight answer.
    if (get().sessions[bookId]?.initialized) return;
    set((state) =>
      mergeSession(state, bookId, {
        messages: [],
        loading: false,
        error: '',
        initialized: true,
      }),
    );
    console.log(`[MyNexus] load session book=${bookId}`);
    try {
      const { sessionId, messages } = await getMyNexusSession(bookId);
      console.log(
        `[MyNexus] session book=${bookId} id=${sessionId ?? 'none'} messages=${messages.length}`,
      );
      set((state) => mergeSession(state, bookId, { messages: applyMindmaps(bookId, messages) }));
      if (messages.length === 0 && bookTitle) {
        void get().send(bookId, `现在我们开始读《${bookTitle}》这本书`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[MyNexus] session failed book=${bookId}: ${message}`);
      set((state) =>
        mergeSession(state, bookId, { error: message || _('AI Companion request failed') }),
      );
    }
  },

  send: async (bookId, text) => {
    const content = text.trim();
    if (!bookId || !content) return;
    const current = get().sessions[bookId];
    if (current?.loading) return;
    const requestMessages: MyNexusMessage[] = [
      ...(current?.messages ?? []),
      { role: 'user', content, createdAt: Date.now() },
    ];
    set((state) =>
      mergeSession(state, bookId, {
        messages: [
          ...requestMessages,
          { role: 'assistant', content: '', citations: [], createdAt: Date.now() },
        ],
        loading: true,
        error: '',
      }),
    );
    console.log(`[MyNexus] send book=${bookId} messages=${requestMessages.length}`);
    try {
      await streamMyNexusChat(bookId, requestMessages, {
        onDelta: (delta) => {
          set((state) =>
            updateLastAssistant(state, bookId, (last) => ({
              ...last,
              content: last.content + delta,
            })),
          );
        },
        onCitations: (citations) => {
          set((state) => updateLastAssistant(state, bookId, (last) => ({ ...last, citations })));
        },
        onToolResult: (tool) => {
          const mindmap = parseMindmapFrame(bookId, tool.toolName, tool.resultJson);
          if (!mindmap) return;
          console.log(`[MyNexus] mindmap received book=${bookId}`);
          set((state) => updateLastAssistant(state, bookId, (last) => ({ ...last, mindmap })));
        },
      });
      console.log(`[MyNexus] send done book=${bookId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[MyNexus] send failed book=${bookId}: ${message}`);
      set((state) => {
        const session = state.sessions[bookId] ?? EMPTY_MYNEXUS_SESSION;
        return mergeSession(state, bookId, {
          messages: session.messages.slice(0, Math.max(0, session.messages.length - 2)),
          error: message || _('AI Companion request failed'),
        });
      });
    } finally {
      set((state) => mergeSession(state, bookId, { loading: false }));
    }
  },
}));
