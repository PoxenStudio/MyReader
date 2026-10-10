import { LRUCache } from '@/utils/lru';
import type { DictionaryLookupOutcome, DictionaryProvider } from './types';

// Handlers the rendered DOM calls into; re-pointed at the live popup on every cache hit.
export interface LookupHandlers {
  onNavigate?: (word: string) => void;
  onAddNote?: (text: string) => void;
}

export interface CachedLookup {
  /** Entries die with their provider instance (its blob URLs are revoked on dispose). */
  provider: DictionaryProvider;
  outcome: DictionaryLookupOutcome;
  /** The rendered card content, kept alive (shadow roots and listeners included). */
  nodes: Node[];
  handlers: LookupHandlers;
}

const MAX_CACHED_LOOKUPS = 50;

export const lookupCache = new LRUCache<string, CachedLookup>(MAX_CACHED_LOOKUPS);

export const makeLookupCacheKey = (parts: (string | boolean | undefined)[]): string =>
  parts.map((p) => String(p ?? '')).join('\u0000');
