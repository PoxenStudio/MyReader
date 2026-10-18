import { emitTo } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauriAppPlatform } from '@/services/environment';

export interface MindmapContent {
  title: string;
  markdown: string;
}

export const MINDMAP_CONTENT_EVENT = 'mynexus-mindmap-content';

const STORAGE_PREFIX = 'mynexus-mindmap-';
const LABEL_PREFIX = 'mindmap-';

const getStorageKey = (bookId: number) => `${STORAGE_PREFIX}${bookId}`;

const getWindowLabel = (bookId: number) => `${LABEL_PREFIX}${bookId}`;

export const readMindmapContent = (bookId: number): MindmapContent | null => {
  if (!bookId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(bookId));
    return raw ? (JSON.parse(raw) as MindmapContent) : null;
  } catch (e) {
    console.error(
      `[MyNexus] mindmap window content read failed book=${bookId}: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
};

// The window is its own JS context, so the markdown travels through the shared
// localStorage payload (read once on load) and, for an already-open window,
// through a Tauri event (the window's listener is live by then).
export const openMindmapWindow = async (bookId: number, content: MindmapContent) => {
  if (!bookId) return;
  try {
    localStorage.setItem(getStorageKey(bookId), JSON.stringify(content));
  } catch (e) {
    console.error(
      `[MyNexus] mindmap window content write failed book=${bookId}: ${e instanceof Error ? e.message : e}`,
    );
  }
  console.log(`[MyNexus] mindmap window open book=${bookId} length=${content.markdown.length}`);

  const label = getWindowLabel(bookId);
  if (!isTauriAppPlatform()) {
    const url = new URL('mindmap', window.location.href);
    url.searchParams.set('id', `${bookId}`);
    url.searchParams.set('t', `${Date.now()}`);
    window.open(url.pathname + url.search, label, 'popup=yes,width=1000,height=720,resizable=yes');
    return;
  }

  const params = new URLSearchParams({ id: `${bookId}`, t: `${Date.now()}` });
  const url = `/mindmap?${params.toString()}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    console.log(`[MyNexus] mindmap window reuse book=${bookId} label=${label}`);
    await existing.setFocus();
    await emitTo(label, MINDMAP_CONTENT_EVENT, content);
    return;
  }

  const win = new WebviewWindow(label, {
    url,
    title: content.title || 'Mind Map',
    width: 1000,
    height: 720,
    center: true,
    resizable: true,
  });
  win.once('tauri://created', () => {
    console.log(`[MyNexus] mindmap window created book=${bookId} label=${label}`);
  });
  win.once('tauri://error', (e) => {
    console.error(`[MyNexus] mindmap window create failed book=${bookId} label=${label}: ${e}`);
  });
};
