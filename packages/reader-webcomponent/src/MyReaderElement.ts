import {
  DocumentLoader,
  getReaderStyles,
  type BookDoc,
  type ReaderConfig,
  type ReaderNote,
  type ReaderProgress,
  type ReaderSyncAdapter,
  type ReaderViewSettings,
} from '@myreader/reader-core';
import { Overlayer } from 'foliate-js/overlayer.js';
import { attachHighlightTrigger, renderHighlightList } from './ui/highlightMenu';
import { renderSettings } from './ui/settings';
import { renderTOC } from './ui/toc';

const NOTE_PREFIX = 'foliate-note:';

// foliate-js ships no .d.ts; this is the minimal slice of <foliate-view>'s
// API that this element needs (see foliate-js/view.js's View class).
interface FoliateRenderer {
  setAttribute: (name: string, value: string) => void;
  setStyles?: (css: string) => void;
}

interface FoliateView extends HTMLElement {
  book: BookDoc;
  renderer: FoliateRenderer;
  open: (book: BookDoc) => Promise<void>;
  init: (options: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>;
  goTo: (target: string | number) => Promise<void>;
  next: (distance?: number) => Promise<void>;
  prev: (distance?: number) => Promise<void>;
  getCFI: (index: number, range: Range) => string;
  addAnnotation: (
    annotation: { value: string; [key: string]: unknown },
    remove?: boolean,
  ) => Promise<{ index: number; label: string } | void>;
}

interface RelocateDetail {
  cfi: string;
  fraction: number;
  tocItem?: { href?: string };
}

interface DrawAnnotationDetail {
  draw: (fn: typeof Overlayer.highlight, opts?: { color?: string }) => void;
  annotation: { color?: string };
}

type OpenSource = string | File | Blob | ArrayBuffer;

interface OpenOptions {
  bookId?: string;
}

const toFile = async (source: OpenSource): Promise<File> => {
  if (source instanceof File) return source;
  if (source instanceof Blob) return new File([source], 'book', { type: source.type });
  if (source instanceof ArrayBuffer) return new File([source], 'book');
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Failed to fetch "${source}": ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  return new File([blob], source.split('/').pop() || 'book', { type: blob.type });
};

export class MyReaderElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['src', 'book-id'];
  }

  autoSyncIntervalMs = 30000;

  #root: ShadowRoot;
  #contentEl: HTMLElement;
  #tocPanel: HTMLElement;
  #settingsPanel: HTMLElement;
  #highlightsPanel: HTMLElement;
  #highlightBtn: HTMLButtonElement;

  #view: FoliateView | null = null;
  #bookId: string | null = null;
  #viewSettings: ReaderViewSettings = { theme: 'auto', pageLayout: 'paginated' };
  #notes: ReaderNote[] = [];
  #lastProgress: ReaderProgress | null = null;
  #syncAdapter: ReaderSyncAdapter | null = null;
  #autoSyncTimer: ReturnType<typeof setInterval> | undefined;
  #highlightsCleanup: (() => void) | null = null;
  #cleanupFns: Array<() => void> = [];

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `
      <style>
        :host { display: block; }
        #toolbar { display: flex; gap: 4px; flex-wrap: wrap; }
        .panel { border: 1px solid #ccc; padding: 8px; max-height: 30%; overflow: auto; }
        #content { width: 100%; height: 100%; }
        foliate-view { display: block; width: 100%; height: 100%; }
      </style>
      <div id="toolbar">
        <button id="toc-toggle" type="button">TOC</button>
        <button id="settings-toggle" type="button">Settings</button>
        <button id="highlights-toggle" type="button">Highlights</button>
        <button id="highlight-btn" type="button" hidden>Highlight selection</button>
        <button id="prev" type="button">&larr; Prev</button>
        <button id="next" type="button">Next &rarr;</button>
      </div>
      <div id="toc-panel" class="panel" hidden></div>
      <div id="settings-panel" class="panel" hidden></div>
      <div id="highlights-panel" class="panel" hidden></div>
      <div id="content"></div>
    `;

    this.#contentEl = this.#root.getElementById('content')!;
    this.#tocPanel = this.#root.getElementById('toc-panel')!;
    this.#settingsPanel = this.#root.getElementById('settings-panel')!;
    this.#highlightsPanel = this.#root.getElementById('highlights-panel')!;
    this.#highlightBtn = this.#root.getElementById('highlight-btn') as HTMLButtonElement;

    this.#root.getElementById('toc-toggle')!.addEventListener('click', () => {
      this.#tocPanel.hidden = !this.#tocPanel.hidden;
    });
    this.#root.getElementById('settings-toggle')!.addEventListener('click', () => {
      this.#settingsPanel.hidden = !this.#settingsPanel.hidden;
    });
    this.#root.getElementById('highlights-toggle')!.addEventListener('click', () => {
      this.#renderHighlightsPanel();
      this.#highlightsPanel.hidden = !this.#highlightsPanel.hidden;
    });
    this.#root.getElementById('prev')!.addEventListener('click', () => void this.prev());
    this.#root.getElementById('next')!.addEventListener('click', () => void this.next());

    this.addEventListener('keydown', this.#onHostKeydown);
  }

  connectedCallback() {
    const src = this.getAttribute('src');
    if (src) void this.open(src);
  }

  disconnectedCallback() {
    void this.#flushSync('close');
    this.#teardown();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (name === 'src' && newValue && newValue !== oldValue && this.isConnected) {
      void this.open(newValue);
    }
  }

  get syncAdapter(): ReaderSyncAdapter | null {
    return this.#syncAdapter;
  }

  set syncAdapter(adapter: ReaderSyncAdapter | null) {
    this.#syncAdapter = adapter;
  }

  async open(source: OpenSource, options: OpenOptions = {}): Promise<void> {
    this.#teardown();
    try {
      this.#bookId = options.bookId ?? this.getAttribute('book-id') ?? '';
      const file = await toFile(source);

      const [{ book, format }, savedConfig] = await Promise.all([
        new DocumentLoader(file).open(),
        this.#loadSyncedConfig(),
      ]);

      if (savedConfig?.viewSettings) {
        this.#viewSettings = { ...this.#viewSettings, ...savedConfig.viewSettings };
      }
      this.#notes = savedConfig?.notes ?? [];

      await import('foliate-js/view.js');
      const view = document.createElement('foliate-view') as FoliateView;
      this.#contentEl.replaceChildren(view);
      this.#view = view;

      view.addEventListener('load', (e) => this.#onSectionLoad((e as CustomEvent).detail));
      view.addEventListener('relocate', (e) => this.#onRelocate((e as CustomEvent).detail));
      view.addEventListener('draw-annotation', (e) => this.#onDrawAnnotation((e as CustomEvent).detail));

      await view.open(book);
      view.renderer.setStyles?.(getReaderStyles(this.#viewSettings));
      view.renderer.setAttribute('flow', this.#viewSettings.pageLayout === 'scrolled' ? 'scrolled' : 'paginated');

      const lastLocation = savedConfig?.progress?.location;
      await view.init(lastLocation ? { lastLocation } : { showTextStart: true });

      renderSettings(this.#settingsPanel, this.#viewSettings, (patch) => this.updateViewSettings(patch));
      const tocCleanup = renderTOC(this.#tocPanel, book.toc ?? [], (href) => void this.goTo(href));
      this.#cleanupFns.push(tocCleanup);

      this.#startAutoSync();

      this.dispatchEvent(new CustomEvent('myreader-ready', { detail: { format, toc: book.toc ?? [] } }));
    } catch (cause) {
      this.dispatchEvent(
        new CustomEvent('myreader-error', {
          detail: { code: 'open-failed', message: (cause as Error).message, cause },
        }),
      );
      throw cause;
    }
  }

  async close(): Promise<void> {
    await this.#flushSync('close');
    this.#teardown();
    this.dispatchEvent(new CustomEvent('myreader-close', { detail: { bookId: this.#bookId } }));
  }

  async goTo(target: string | number): Promise<void> {
    await this.#view?.goTo(target);
  }

  async next(): Promise<void> {
    await this.#view?.next();
  }

  async prev(): Promise<void> {
    await this.#view?.prev();
  }

  getProgress(): ReaderProgress | null {
    return this.#lastProgress;
  }

  getNotes(): ReaderNote[] {
    return this.#notes;
  }

  setNotes(notes: ReaderNote[]): void {
    this.#notes = notes;
    this.#applyNotes();
    this.#renderHighlightsPanel();
  }

  updateViewSettings(patch: Partial<ReaderViewSettings>): void {
    this.#viewSettings = { ...this.#viewSettings, ...patch };
    if (this.#view) {
      this.#view.renderer.setStyles?.(getReaderStyles(this.#viewSettings));
      this.#view.renderer.setAttribute(
        'flow',
        this.#viewSettings.pageLayout === 'scrolled' ? 'scrolled' : 'paginated',
      );
    }
  }

  async flushSync(): Promise<void> {
    await this.#flushSync('manual');
  }

  #onHostKeydown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      void this.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      void this.prev();
    }
  };

  #onSectionLoad(detail: { doc: Document; index: number }): void {
    const { doc, index } = detail;

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        void this.next();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        void this.prev();
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('a')) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().length > 0) return;

      // foliate-js's paginator renders the whole (possibly multi-page) section
      // into one oversized iframe and slides/clips it to show one spread at a
      // time, so e.clientX (iframe-local) is NOT comparable to the visible
      // page width. The iframe is same-origin (`allow-same-origin`), so we can
      // reach back out to its own <iframe> element via `frameElement` and
      // re-derive the click's position relative to our own visible container.
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      const containerRect = this.#contentEl.getBoundingClientRect();
      if (!frame || containerRect.width === 0) return;
      const frameRect = frame.getBoundingClientRect();
      const relativeX = frameRect.left + e.clientX - containerRect.left;

      if (relativeX < containerRect.width / 3) void this.prev();
      else if (relativeX > (containerRect.width * 2) / 3) void this.next();
    };
    doc.addEventListener('keydown', onKeydown);
    doc.addEventListener('click', onClick);
    this.#cleanupFns.push(() => {
      doc.removeEventListener('keydown', onKeydown);
      doc.removeEventListener('click', onClick);
    });

    const highlightCleanup = attachHighlightTrigger(doc, this.#highlightBtn, () =>
      this.#addHighlight(doc, index),
    );
    this.#cleanupFns.push(highlightCleanup);

    this.#applyNotes();
  }

  #onRelocate(detail: RelocateDetail): void {
    this.#lastProgress = {
      bookId: this.#bookId ?? '',
      location: detail.cfi,
      sectionHref: detail.tocItem?.href,
      percentage: detail.fraction ?? 0,
      updatedAt: Date.now(),
    };
    this.dispatchEvent(new CustomEvent('myreader-progress', { detail: this.#lastProgress }));
  }

  #onDrawAnnotation(detail: DrawAnnotationDetail): void {
    detail.draw(Overlayer.highlight, { color: detail.annotation.color ?? 'yellow' });
  }

  #applyNotes(): void {
    if (!this.#view) return;
    for (const note of this.#notes) {
      void this.#view.addAnnotation({ value: NOTE_PREFIX + note.cfi, ...note });
    }
  }

  #addHighlight(doc: Document, index: number): void {
    if (!this.#view) return;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const cfi = this.#view.getCFI(index, range);
    const now = Date.now();
    const note: ReaderNote = {
      id: crypto.randomUUID(),
      bookId: this.#bookId ?? '',
      type: 'annotation',
      cfi,
      text: sel.toString(),
      style: 'highlight',
      color: 'yellow',
      createdAt: now,
      updatedAt: now,
    };
    this.#notes = [...this.#notes, note];
    void this.#view.addAnnotation({ value: NOTE_PREFIX + cfi, ...note });
    sel.removeAllRanges();
    this.#highlightBtn.hidden = true;
    this.#renderHighlightsPanel();
    this.dispatchEvent(new CustomEvent('myreader-notechange', { detail: { notes: this.#notes } }));
  }

  #deleteHighlight(id: string): void {
    const note = this.#notes.find((n) => n.id === id);
    if (!note || !this.#view) return;
    this.#notes = this.#notes.filter((n) => n.id !== id);
    void this.#view.addAnnotation({ value: NOTE_PREFIX + note.cfi }, true);
    this.#renderHighlightsPanel();
    this.dispatchEvent(new CustomEvent('myreader-notechange', { detail: { notes: this.#notes } }));
  }

  #renderHighlightsPanel(): void {
    this.#highlightsCleanup?.();
    this.#highlightsCleanup = renderHighlightList(this.#highlightsPanel, this.#notes, (id) =>
      this.#deleteHighlight(id),
    );
  }

  async #loadSyncedConfig(): Promise<ReaderConfig | null> {
    if (!this.#syncAdapter || !this.#bookId) return null;
    try {
      return await this.#syncAdapter.loadProgress(this.#bookId);
    } catch (error) {
      this.#handleSyncError(error, 'load');
      return null;
    }
  }

  async #flushSync(reason: 'close' | 'auto' | 'manual'): Promise<void> {
    if (!this.#syncAdapter || !this.#bookId) return;
    const config: ReaderConfig = {
      ...(this.#lastProgress ? { progress: this.#lastProgress } : {}),
      viewSettings: this.#viewSettings,
      notes: this.#notes,
    };
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    try {
      await Promise.race([this.#syncAdapter.saveProgress(this.#bookId, config, reason), timeout]);
    } catch (error) {
      this.#handleSyncError(error, 'save');
    }
  }

  #handleSyncError(error: unknown, op: 'load' | 'save'): void {
    this.#syncAdapter?.onError?.(error, { bookId: this.#bookId ?? '', op });
    this.dispatchEvent(
      new CustomEvent('myreader-error', {
        detail: { code: `sync-${op}-failed`, message: (error as Error).message, cause: error },
      }),
    );
  }

  #startAutoSync(): void {
    this.#stopAutoSync();
    if (this.autoSyncIntervalMs <= 0) return;
    this.#autoSyncTimer = setInterval(() => void this.#flushSync('auto'), this.autoSyncIntervalMs);
  }

  #stopAutoSync(): void {
    if (this.#autoSyncTimer !== undefined) {
      clearInterval(this.#autoSyncTimer);
      this.#autoSyncTimer = undefined;
    }
  }

  #teardown(): void {
    this.#stopAutoSync();
    for (const fn of this.#cleanupFns) fn();
    this.#cleanupFns = [];
    this.#highlightsCleanup?.();
    this.#highlightsCleanup = null;
    this.#view?.remove();
    this.#view = null;
  }
}

export function defineMyReaderElement() {
  if (!customElements.get('myreader-view')) {
    customElements.define('myreader-view', MyReaderElement);
  } else {
    console.warn('myreader-view is already defined; skipping redefinition.');
  }
}
