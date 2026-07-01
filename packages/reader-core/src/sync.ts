export interface ReaderProgress {
  bookId: string;
  location: string; // EPUB: CFI; PDF/CBZ: page number as string
  sectionHref?: string;
  percentage: number; // 0~1, whole-book progress
  updatedAt: number; // epoch ms
}

export interface ReaderViewSettings {
  theme: 'light' | 'dark' | 'auto';
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  pageLayout: 'paginated' | 'scrolled';
}

export interface ReaderNote {
  id: string; // stable id (e.g. uuid), host round-trips it as-is
  bookId: string;
  type: 'bookmark' | 'annotation' | 'excerpt';
  cfi: string;
  text?: string;
  style?: 'highlight' | 'underline' | 'squiggly';
  color?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface ReaderConfig {
  progress?: ReaderProgress;
  viewSettings?: ReaderViewSettings;
  notes?: ReaderNote[];
}

export interface ReaderSyncAdapter {
  /** Called once on open() to fetch previously saved state. Returns null for a brand-new book. */
  loadProgress(bookId: string): Promise<ReaderConfig | null>;

  /**
   * Saves reader state. Called:
   *  - on close() (reason: 'close');
   *  - periodically in the background (reason: 'auto'), interval controlled by
   *    autoSyncIntervalMs (default 30s; 0 disables auto-sync, only close() syncs);
   *  - when the host calls flushSync() (reason: 'manual').
   */
  saveProgress(bookId: string, config: ReaderConfig, reason: 'close' | 'auto' | 'manual'): Promise<void>;

  /** Optional error hook; if absent, the component only dispatches myreader-error. */
  onError?(error: unknown, context: { bookId: string; op: 'load' | 'save' }): void;
}
