import * as CFI from 'foliate-js/epubcfi.js';
import type { ConvertChineseVariant, RawLocationAnchor, ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';
import { TRANSFORM_PIPELINE_VERSION } from '@/services/transformers/version';

// Version of the raw-text extraction rules below. Bump when the rules change;
// anchors written by another version degrade to rawFraction instead of being
// applied at a wrong offset.
export const RAW_TEXT_VERSION = 1;

const RAW_CACHE_LIMIT = 3;
const RENDERED_CACHE_LIMIT = 2;
// Above this many characters the per-character mapping tables cost tens of
// MB per section. Such sections fall back to rawFraction instead of exact
// text mapping (a single-file book can otherwise stall the main thread).
const MAX_EXACT_MAPPING_CHARS = 1_000_000;
const MAX_OCCURRENCES = 64;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
};

export interface TextStream {
  text: string;
  nodes: Text[];
  offsets: number[];
  // Sparse alternative to the per-character tables: one entry per text node.
  // Huge sections keep only this, and textOffsetToRange binary-searches it.
  nodeStarts?: { start: number; node: Text }[];
}

export interface SearchableText extends TextStream {
  normalized: string;
  normalizedToText: number[];
  textToNormalized: number[];
}

export interface RawTextInfo {
  searchable: SearchableText;
  hash: string;
  version: number;
}

export interface RenderedTextInfo extends SearchableText {
  doc: Document;
  // false when the loader could not provide transformed HTML and the raw
  // section document was used instead; callers must not claim exact mapping.
  transformed: boolean;
}

interface LoadableSection {
  createDocument: () => Promise<Document>;
  load?: () => Promise<string>;
  loadContent?: () => Promise<string | undefined>;
  unload?: () => void;
  loadText?: () => Promise<string | null>;
  href?: string;
  id?: string;
}

interface TextNodeOptions {
  skipInert: boolean;
  skipChunk: boolean;
  // Raw text only needs the characters; keeping a node/offset entry per
  // character for every section costs several MB for no benefit.
  collectPositions?: boolean;
}

const DEFAULT_TEXT_NODE_OPTIONS: TextNodeOptions = { skipInert: true, skipChunk: true };

// RT/RP/RTC are ruby annotations: the overlayer ignores them too, and Word
// Lens injects ruby into the live document only, so including them would make
// the live window differ from the detached transformed document.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'RT', 'RP', 'RTC']);
const nodeOptionsCache = new WeakMap<Document, Map<string, Text[]>>();

const shouldSkipText = (node: Text, options: TextNodeOptions): boolean => {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (options.skipInert && el.hasAttribute('cfi-inert')) return true;
    if (options.skipChunk && el.hasAttribute('data-foliate-chunk')) return true;
  }
  return false;
};

const getOrderedTextNodes = (doc: Document, options = DEFAULT_TEXT_NODE_OPTIONS): Text[] => {
  const key = `${options.skipInert ? 1 : 0}${options.skipChunk ? 1 : 0}`;
  let byOptions = nodeOptionsCache.get(doc);
  if (!byOptions) {
    byOptions = new Map();
    nodeOptionsCache.set(doc, byOptions);
  }
  const cached = byOptions.get(key);
  if (cached) return cached;

  const nodes: Text[] = [];
  const root = doc.body ?? doc.documentElement;
  if (root) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode() as Text | null;
    while (current) {
      if (!shouldSkipText(current, options)) nodes.push(current);
      current = walker.nextNode() as Text | null;
    }
  }
  byOptions.set(key, nodes);
  return nodes;
};

export const collectTextStream = (
  doc: Document,
  options: TextNodeOptions = DEFAULT_TEXT_NODE_OPTIONS,
): TextStream => {
  const textNodes = getOrderedTextNodes(doc, options);
  const collectPositions = options.collectPositions ?? true;
  const chunks: string[] = [];
  const nodes: Text[] = [];
  const offsets: number[] = [];
  const nodeStarts: { start: number; node: Text }[] = [];
  let total = 0;
  for (const node of textNodes) {
    const value = node.nodeValue;
    if (!value) continue;
    nodeStarts.push({ start: total, node });
    total += value.length;
    chunks.push(value);
    if (!collectPositions) continue;
    for (let i = 0; i < value.length; i++) {
      nodes.push(node);
      offsets.push(i);
    }
  }
  return { text: chunks.join(''), nodes, offsets, nodeStarts };
};

const PUNCT_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u300C': '"',
  '\u300D': '"',
  '\u300E': '"',
  '\u300F': '"',
  '\uFE41': '"',
  '\uFE42': '"',
  '\uFE43': '"',
  '\uFE44': '"',
  '\u301D': '"',
  '\u301E': '"',
  '\u301F': '"',
};

const isWhitespace = (ch: string): boolean => ch === '\u00A0' || ch === '\u3000' || /\s/u.test(ch);

export interface SearchNormalizeOptions {
  // Converts the stream's text toward the raw book's Chinese variant before
  // matching. Direction is resolved by the caller (runSimpleCC(reverse=true)).
  convertVariant?: (text: string) => string;
}

// Phrase-level converters (simplecc's *twp variants) can change length. A
// whole-string conversion keeps the phrase table but has no source mapping;
// per-character conversion has a map but loses the phrase table. Split until
// the unaffected blocks are 1:1 and only changed blocks are subdivided.
const convertVariantWithMapping = (
  text: string,
  convert: (text: string) => string,
): { text: string; map: number[] | null } => {
  const whole = convert(text);
  if (whole.length === text.length) return { text: whole, map: null };

  const parts: string[] = [];
  const map: number[] = [];
  const convertRange = (start: number, end: number): void => {
    const chunk = text.slice(start, end);
    if (!chunk) return;
    let convertedChunk: string;
    try {
      convertedChunk = convert(chunk);
    } catch {
      convertedChunk = chunk;
    }
    if (convertedChunk.length === chunk.length) {
      parts.push(convertedChunk);
      for (let k = 0; k < chunk.length; k++) map.push(start + k);
      return;
    }
    if (end - start <= 16) {
      for (let i = start; i < end; ) {
        const cp = text.codePointAt(i)!;
        const len = cp > 0xffff ? 2 : 1;
        const piece = text.slice(i, i + len);
        let convertedPiece = piece;
        try {
          convertedPiece = convert(piece);
        } catch {
          // keep the source character
        }
        parts.push(convertedPiece);
        for (let k = 0; k < convertedPiece.length; k++) map.push(i);
        i += len;
      }
      return;
    }
    const mid = start + Math.floor((end - start) / 2);
    convertRange(start, mid);
    convertRange(mid, end);
  };
  convertRange(0, text.length);
  return { text: parts.join(''), map };
};

export const normalizeSearchable = (
  stream: TextStream,
  options: SearchNormalizeOptions = {},
): SearchableText => {
  let converted = stream.text;
  let convertedMap: number[] | null = null;

  if (options.convertVariant && stream.text) {
    try {
      const convertedResult = convertVariantWithMapping(stream.text, options.convertVariant);
      converted = convertedResult.text;
      convertedMap = convertedResult.map;
    } catch {
      // Variant conversion is an optimization; matching still has the
      // rawFraction fallback.
    }
  }

  const normalizedParts: string[] = [];
  const normalizedToText: number[] = [];
  let prevSpace = false;
  let i = 0;
  while (i < converted.length) {
    const cp = converted.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const orig = convertedMap ? (convertedMap[i] ?? i) : i;
    i += ch.length;

    if (isWhitespace(ch)) {
      if (!prevSpace) {
        normalizedParts.push(' ');
        normalizedToText.push(orig);
        prevSpace = true;
      }
      continue;
    }
    prevSpace = false;
    // Iterate by code unit: normalizedParts.length is the string index used
    // by textToNormalized below. Iterating NFKC by code point would desync
    // the two for astral characters (emoji, CJK Ext-B).
    const nfkc = ch.normalize('NFKC');
    for (let k = 0; k < nfkc.length; k++) {
      const normalizedChar = nfkc[k]!;
      normalizedParts.push(PUNCT_MAP[normalizedChar] ?? normalizedChar);
      normalizedToText.push(orig);
    }
  }

  const normalized = normalizedParts.join('');
  const textToNormalized = new Array<number>(stream.text.length + 1).fill(normalized.length);
  let cursor = 0;
  for (let n = 0; n < normalizedToText.length; n++) {
    const orig = Math.min(normalizedToText[n]!, stream.text.length);
    if (orig < cursor) continue;
    for (let j = cursor; j <= orig; j++) textToNormalized[j] = n;
    cursor = orig + 1;
  }

  return { ...stream, normalized, normalizedToText, textToNormalized };
};

export const normalizeString = (text: string, options: SearchNormalizeOptions = {}): string =>
  normalizeSearchable({ text, nodes: [], offsets: [] }, options).normalized;

export const findOccurrences = (haystack: string, needle: string): number[] => {
  if (!needle) return [];
  const occurrences: number[] = [];
  let from = 0;
  while (occurrences.length < MAX_OCCURRENCES) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    occurrences.push(index);
    from = index + 1;
  }
  return occurrences;
};

const pickClosest = (occurrences: number[], target: number): number =>
  occurrences.reduce((best, next) =>
    Math.abs(next - target) < Math.abs(best - target) ? next : best,
  );

export const extractTextAround = (
  text: string,
  offset: number,
  quoteLength = 64,
  contextLength = 24,
): { quote: string; prefix: string; suffix: string } => {
  const start = clamp(Math.round(offset), 0, text.length);
  const quote = text.slice(start, start + quoteLength);
  return {
    quote,
    prefix: text.slice(Math.max(0, start - contextLength), start),
    suffix: text.slice(start + quote.length, start + quote.length + contextLength),
  };
};

export const buildRawAnchor = (
  raw: RawTextInfo,
  index: number,
  rawOffset: number,
  precision: 'exact' | 'approx',
): RawLocationAnchor => {
  const safeOffset = Number.isFinite(rawOffset) ? rawOffset : 0;
  const offset = clamp(Math.round(safeOffset), 0, raw.searchable.text.length);
  const { quote, prefix, suffix } = extractTextAround(raw.searchable.text, offset);
  return {
    v: 2,
    index,
    rawOffset: offset,
    rawFraction: raw.searchable.text.length ? offset / raw.searchable.text.length : 0,
    rawQuote: quote,
    rawPrefix: prefix,
    rawSuffix: suffix,
    sectionHash: raw.hash,
    rawTextVersion: raw.version,
    precision,
  };
};

export const textOffsetToRange = (stream: SearchableText, offset: number): Range | null => {
  if (!stream.text) return null;
  if (!Number.isFinite(offset)) return null;
  const index = clamp(Math.round(offset), 0, stream.text.length);

  if (stream.nodes.length > 0) {
    const node =
      index < stream.nodes.length ? stream.nodes[index]! : stream.nodes[stream.nodes.length - 1]!;
    const nodeOffset =
      index < stream.offsets.length ? stream.offsets[index]! : (node.nodeValue?.length ?? 0);
    const range = node.ownerDocument.createRange();
    range.setStart(node, nodeOffset);
    range.collapse(true);
    return range;
  }

  const starts = stream.nodeStarts;
  if (!starts || starts.length === 0) return null;
  let low = 0;
  let high = starts.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (starts[mid]!.start <= index) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const { node, start } = starts[found]!;
  const range = node.ownerDocument.createRange();
  range.setStart(node, clamp(index - start, 0, node.nodeValue?.length ?? 0));
  range.collapse(true);
  return range;
};

export const mapRenderedOffsetToRaw = (
  rendered: SearchableText,
  raw: SearchableText,
  renderedOffset: number,
  hintFraction?: number,
): { offset: number; mode: 'exact' | 'approx' } => {
  const rawLength = raw.text.length;
  const safeRenderedOffset = Number.isFinite(renderedOffset) ? renderedOffset : 0;
  const safeHint = hintFraction != null && Number.isFinite(hintFraction) ? hintFraction : undefined;
  const fraction = safeHint ?? safeRenderedOffset / Math.max(1, rendered.text.length);
  const fallback = clamp(Math.round(fraction * rawLength), 0, rawLength);
  if (!rendered.normalized || !raw.normalized || rawLength === 0) {
    return { offset: fallback, mode: 'approx' };
  }

  const textOffset = clamp(Math.round(safeRenderedOffset), 0, rendered.text.length);
  const anchorNormalized = rendered.textToNormalized[textOffset] ?? 0;
  const scale = rawLength / Math.max(1, rendered.text.length);
  const hint = safeHint != null ? safeHint * raw.normalized.length : anchorNormalized;
  const minMatch = Math.min(8, Math.max(2, rawLength));

  const tryWindow = (startAt: number, length: number): number | null => {
    const start = clamp(startAt, 0, Math.max(0, rendered.normalized.length - length));
    const needle = rendered.normalized.slice(start, start + length);
    if (needle.trim().length < minMatch) return null;
    const occurrences = findOccurrences(raw.normalized, needle);
    if (occurrences.length === 0) return null;
    const best = occurrences.length === 1 ? occurrences[0]! : pickClosest(occurrences, hint);
    const rawTextStart = raw.normalizedToText[best] ?? 0;
    const renderedTextStart = rendered.normalizedToText[start] ?? 0;
    return clamp(Math.round(rawTextStart + (textOffset - renderedTextStart) * scale), 0, rawLength);
  };

  for (const length of [96, 64, 48, 32]) {
    const mapped = tryWindow(anchorNormalized, length);
    if (mapped != null) return { offset: mapped, mode: 'exact' };
  }

  for (const step of [32, 64, 128, 256]) {
    for (const direction of [1, -1]) {
      const mapped = tryWindow(anchorNormalized + direction * step, 64);
      if (mapped != null) return { offset: mapped, mode: 'approx' };
    }
  }

  return { offset: fallback, mode: 'approx' };
};

export const mapRawAnchorToRendered = (
  rawInfo: RawTextInfo,
  rendered: SearchableText,
  anchor: RawLocationAnchor,
): { offset: number; mode: 'exact' | 'approx' } => {
  const raw = rawInfo.searchable;
  const renderedLength = rendered.text.length;
  const approximate = anchor.precision !== 'exact';
  const safeFraction = Number.isFinite(anchor.rawFraction) ? anchor.rawFraction : 0;
  const fallback = clamp(
    Math.round(safeFraction * renderedLength),
    0,
    Math.max(0, renderedLength - 1),
  );
  if (
    anchor.v !== 2 ||
    anchor.sectionHash !== rawInfo.hash ||
    anchor.rawTextVersion !== rawInfo.version ||
    typeof anchor.rawQuote !== 'string' ||
    !Number.isFinite(anchor.rawOffset) ||
    !rendered.normalized
  ) {
    return { offset: fallback, mode: 'approx' };
  }

  const hint = safeFraction * rendered.normalized.length;
  const mappedFromOccurrences = (occurrences: number[]): number => {
    const best = occurrences.length === 1 ? occurrences[0]! : pickClosest(occurrences, hint);
    return rendered.normalizedToText[best] ?? fallback;
  };

  const minMatch = Math.min(8, Math.max(2, raw.text.length));
  const quote = normalizeString(anchor.rawQuote);
  if (quote.length >= minMatch) {
    const occurrences = findOccurrences(rendered.normalized, quote);
    if (occurrences.length > 0) {
      return {
        offset: mappedFromOccurrences(occurrences),
        mode: approximate ? 'approx' : 'exact',
      };
    }
  }

  const rawNormalizedOffset =
    raw.textToNormalized[clamp(anchor.rawOffset, 0, raw.text.length)] ?? 0;
  const scale = renderedLength / Math.max(1, raw.text.length);

  const tryRawWindow = (startAt: number, length: number): number | null => {
    const start = clamp(startAt, 0, Math.max(0, raw.normalized.length - length));
    const needle = raw.normalized.slice(start, start + length);
    if (needle.trim().length < minMatch) return null;
    const occurrences = findOccurrences(rendered.normalized, needle);
    if (occurrences.length === 0) return null;
    const best = occurrences.length === 1 ? occurrences[0]! : pickClosest(occurrences, hint);
    const renderedTextStart = rendered.normalizedToText[best] ?? 0;
    const rawTextStart = raw.normalizedToText[start] ?? 0;
    return clamp(
      Math.round(renderedTextStart + (anchor.rawOffset - rawTextStart) * scale),
      0,
      Math.max(0, renderedLength - 1),
    );
  };

  for (const length of [96, 64, 48, 32]) {
    const mapped = tryRawWindow(rawNormalizedOffset, length);
    if (mapped != null) {
      return { offset: mapped, mode: approximate ? 'approx' : 'exact' };
    }
  }

  for (const step of [64, 128, 256]) {
    for (const direction of [1, -1]) {
      const mapped = tryRawWindow(rawNormalizedOffset + direction * step, 64);
      if (mapped != null) return { offset: mapped, mode: 'approx' };
    }
  }

  return { offset: fallback, mode: 'approx' };
};

export const collectWindowAtPoint = (
  doc: Document,
  container: Node,
  offset: number,
  maxLength: number,
): { text: string; node: Text; offset: number } | null => {
  let nodes = getOrderedTextNodes(doc);
  if (nodes.length === 0) return null;

  let startIndex = -1;
  let startOffset = 0;
  if (container.nodeType === Node.TEXT_NODE) {
    startIndex = nodes.indexOf(container as Text);
    if (startIndex < 0) {
      // WordLens / syntax highlighting split text nodes after the first walk.
      // Rebuild once before giving up on the exact window.
      nodeOptionsCache.delete(doc);
      nodes = getOrderedTextNodes(doc);
      startIndex = nodes.indexOf(container as Text);
    }
    if (startIndex < 0) return null;
    startOffset = clamp(offset, 0, (container as Text).nodeValue?.length ?? 0);
  } else {
    const probe = doc.createRange();
    try {
      probe.setStart(container, offset);
      probe.collapse(true);
    } catch {
      return null;
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (probe.comparePoint(node, node.nodeValue?.length ?? 0) >= 0) {
        startIndex = i;
        startOffset = 0;
        break;
      }
    }
  }
  if (startIndex < 0) return null;

  const parts: string[] = [];
  let remaining = maxLength;
  for (let i = startIndex; i < nodes.length && remaining > 0; i++) {
    const value = nodes[i]!.nodeValue ?? '';
    const from = i === startIndex ? startOffset : 0;
    const piece = value.slice(from, from + remaining);
    if (piece) {
      parts.push(piece);
      remaining -= piece.length;
    }
  }
  return { text: parts.join(''), node: nodes[startIndex]!, offset: startOffset };
};

export const isCfiWithinRange = (
  targetCfi: string | undefined,
  visibleRangeCfi: string | undefined,
): boolean => {
  if (!targetCfi || !visibleRangeCfi) return false;
  try {
    const target = CFI.collapse(targetCfi);
    const start = CFI.collapse(visibleRangeCfi);
    const end = CFI.collapse(visibleRangeCfi, true);
    return CFI.compare(target, start) >= 0 && CFI.compare(target, end) <= 0;
  } catch {
    return false;
  }
};

const makeVariantConverter = async (
  variant?: ConvertChineseVariant,
): Promise<((text: string) => string) | undefined> => {
  if (!variant || variant === 'none') return undefined;
  try {
    await initSimpleCC();
  } catch {
    return undefined;
  }
  return (text: string) => runSimpleCC(text, variant, true);
};

const proofreadHash = (settings: ViewSettings | null): string =>
  fnv1a(JSON.stringify(settings?.proofreadRules ?? []));

const transformSignature = (settings: ViewSettings | null): string =>
  [
    RAW_TEXT_VERSION,
    TRANSFORM_PIPELINE_VERSION,
    settings?.overrideLayout ? 1 : 0,
    settings?.replaceQuotationMarks ? 1 : 0,
    settings?.vertical ? 1 : 0,
    settings?.convertChineseVariant ?? 'none',
    proofreadHash(settings),
  ].join('|');

const rawCache = new Map<string, Promise<RawTextInfo | null>>();
const renderedCache = new Map<
  string,
  { signature: string; promise: Promise<RenderedTextInfo | null> }
>();

const cacheKey = (bookKey: string, index: number): string => `${bookKey}\u0000${index}`;

const sectionAt = (view: FoliateView, index: number): LoadableSection | null => {
  const sections = (view.book as unknown as { sections?: LoadableSection[] }).sections;
  return sections?.[index] ?? null;
};

const getRawText = (
  bookKey: string,
  view: FoliateView,
  index: number,
): Promise<RawTextInfo | null> => {
  const key = cacheKey(bookKey, index);
  const cached = rawCache.get(key);
  if (cached) {
    // LRU touch: sequential books otherwise evict the section being returned to.
    rawCache.delete(key);
    rawCache.set(key, cached);
    return cached;
  }
  const promise = (async () => {
    const section = sectionAt(view, index);
    if (!section?.createDocument) return null;
    const doc = await section.createDocument();
    const stream = collectTextStream(doc, {
      skipInert: false,
      skipChunk: false,
      collectPositions: false,
    });
    const hash = `${fnv1a(stream.text)}-${stream.text.length}`;
    if (stream.text.length > MAX_EXACT_MAPPING_CHARS) {
      return {
        searchable: {
          ...stream,
          normalized: '',
          normalizedToText: [],
          textToNormalized: [],
        },
        hash,
        version: RAW_TEXT_VERSION,
      } satisfies RawTextInfo;
    }
    const searchable = normalizeSearchable(stream);
    return {
      searchable,
      hash,
      version: RAW_TEXT_VERSION,
    } satisfies RawTextInfo;
  })().catch((error) => {
    console.warn('[sync] failed to build raw section text', index, error);
    return null;
  });
  rawCache.set(key, promise);
  promise.then((result) => {
    // Do not cache a "section not loaded yet" failure for the whole session.
    if (!result && rawCache.get(key) === promise) rawCache.delete(key);
  });
  if (rawCache.size > RAW_CACHE_LIMIT) {
    const oldest = rawCache.keys().next().value;
    if (oldest !== undefined) rawCache.delete(oldest);
  }
  return promise;
};

const readRenderedDocument = async (
  section: LoadableSection,
): Promise<{ doc: Document; transformed: boolean } | null> => {
  let loadHeld = false;
  try {
    if (section.load && section.loadContent) {
      try {
        await section.load();
        loadHeld = true;
      } catch {
        loadHeld = false;
      }
    }
    const html = loadHeld ? await section.loadContent?.() : undefined;
    if (html) {
      return { doc: new DOMParser().parseFromString(html, 'text/html'), transformed: true };
    }
    const doc = await section.createDocument();
    return doc ? { doc, transformed: false } : null;
  } catch (error) {
    console.warn('[sync] failed to build rendered section document', error);
    return null;
  } finally {
    if (loadHeld) section.unload?.();
  }
};

const getRenderedText = (
  bookKey: string,
  view: FoliateView,
  index: number,
  settings: ViewSettings | null,
): Promise<RenderedTextInfo | null> => {
  const key = cacheKey(bookKey, index);
  const signature = transformSignature(settings);
  const cached = renderedCache.get(key);
  if (cached?.signature === signature) {
    renderedCache.delete(key);
    renderedCache.set(key, cached);
    return cached.promise;
  }

  const promise = (async () => {
    const section = sectionAt(view, index);
    if (!section) return null;
    const rendered = await readRenderedDocument(section);
    if (!rendered) return null;
    const textOnly = collectTextStream(rendered.doc, {
      skipInert: true,
      skipChunk: true,
      collectPositions: false,
    });
    if (textOnly.text.length > MAX_EXACT_MAPPING_CHARS) {
      return {
        ...textOnly,
        normalized: '',
        normalizedToText: [],
        textToNormalized: [],
        doc: rendered.doc,
        transformed: rendered.transformed,
      } satisfies RenderedTextInfo;
    }
    const converter = await makeVariantConverter(settings?.convertChineseVariant);
    const stream = collectTextStream(rendered.doc);
    const searchable = normalizeSearchable(stream, { convertVariant: converter });
    return {
      ...searchable,
      doc: rendered.doc,
      transformed: rendered.transformed,
    } satisfies RenderedTextInfo;
  })().catch((error) => {
    console.warn('[sync] failed to build rendered section text', index, error);
    return null;
  });

  renderedCache.set(key, { signature, promise });
  promise.then((result) => {
    if (!result && renderedCache.get(key)?.promise === promise) renderedCache.delete(key);
  });
  if (renderedCache.size > RENDERED_CACHE_LIMIT) {
    const oldest = renderedCache.keys().next().value;
    if (oldest !== undefined) renderedCache.delete(oldest);
  }
  return promise;
};

const findBestWindow = (
  rendered: SearchableText,
  normalizedWindow: string,
  hint: number,
): number | null => {
  if (normalizedWindow.trim().length < Math.min(8, Math.max(2, rendered.text.length))) {
    return null;
  }
  const occurrences = findOccurrences(rendered.normalized, normalizedWindow);
  if (occurrences.length === 0) return null;
  const best = occurrences.length === 1 ? occurrences[0]! : pickClosest(occurrences, hint);
  return rendered.normalizedToText[best] ?? null;
};

export const buildRawAnchorForRange = async (
  bookKey: string,
  view: FoliateView,
  index: number,
  range: Range,
  fraction: number,
  settings: ViewSettings | null,
): Promise<RawLocationAnchor | null> => {
  const [raw, rendered, converter] = await Promise.all([
    getRawText(bookKey, view, index),
    getRenderedText(bookKey, view, index, settings),
    makeVariantConverter(settings?.convertChineseVariant),
  ]);
  if (!raw) return null;
  if (raw.searchable.text.length === 0) return null;

  if (!rendered || !rendered.transformed || !rendered.normalized) {
    return buildRawAnchor(raw, index, fraction * raw.searchable.text.length, 'approx');
  }

  const doc = range.startContainer.ownerDocument;
  const window = doc
    ? collectWindowAtPoint(doc, range.startContainer, range.startOffset, 96)
    : null;
  const normalizedWindow = window
    ? normalizeString(window.text, { convertVariant: converter })
    : '';
  const hint = fraction * rendered.normalized.length;
  const renderedOffset = findBestWindow(rendered, normalizedWindow, hint);
  const targetRenderedOffset =
    renderedOffset != null ? renderedOffset : Math.round(fraction * rendered.text.length);
  const mapped = mapRenderedOffsetToRaw(rendered, raw.searchable, targetRenderedOffset, fraction);
  const precision: 'exact' | 'approx' =
    renderedOffset != null && mapped.mode === 'exact' ? 'exact' : 'approx';
  return buildRawAnchor(raw, index, mapped.offset, precision);
};

export const resolveRawAnchorToCfi = async (
  bookKey: string,
  view: FoliateView,
  anchor: RawLocationAnchor,
  settings: ViewSettings | null,
): Promise<{ cfi: string; mode: 'exact' | 'approx' } | null> => {
  const [raw, rendered] = await Promise.all([
    getRawText(bookKey, view, anchor.index),
    getRenderedText(bookKey, view, anchor.index, settings),
  ]);
  if (!raw || !rendered) return null;
  const mapped =
    rendered.transformed && rendered.normalized
      ? mapRawAnchorToRendered(raw, rendered, anchor)
      : {
          offset: clamp(
            Math.round(anchor.rawFraction * rendered.text.length),
            0,
            Math.max(0, rendered.text.length - 1),
          ),
          mode: 'approx' as const,
        };
  const range = textOffsetToRange(rendered, mapped.offset);
  if (!range) return null;
  try {
    return { cfi: view.getCFI(anchor.index, range), mode: mapped.mode };
  } catch (error) {
    console.warn('[sync] failed to build CFI from raw anchor', error);
    return null;
  }
};

// Legacy records only carry a CFI. Collapse it to a point first (the old
// page-range end is what usually overflows), then resolve it against the
// section's transformed document. Returning null means the record cannot be
// placed on this device; the caller keeps the local position instead of
// guessing a page.
export const resolveLegacyCfiToLocal = async (
  bookKey: string,
  view: FoliateView,
  cfi: string,
  settings: ViewSettings | null,
): Promise<{ cfi: string; index: number } | null> => {
  let collapsed: string;
  let index: number;
  try {
    collapsed = CFI.collapse(cfi);
    index = view.resolveCFI(collapsed).index;
  } catch {
    return null;
  }
  if (index == null || index < 0) return null;
  const rendered = await getRenderedText(bookKey, view, index, settings);
  const doc = rendered?.doc;
  // Without the transformed baseline, resolving a foreign CFI here would be
  // self-consistent but semantically wrong; let the renderer try the live doc.
  if (!doc || !rendered.transformed) return null;
  let range: Range | null = null;
  try {
    range = CFI.toRange(doc, CFI.parse(collapsed));
  } catch {
    range = null;
  }
  if (!range) return null;
  try {
    return { cfi: view.getCFI(index, range), index };
  } catch {
    return null;
  }
};

export const resetLocationCaches = (bookKey?: string): void => {
  if (!bookKey) {
    rawCache.clear();
    renderedCache.clear();
    return;
  }
  const prefix = `${bookKey}\u0000`;
  for (const key of Array.from(rawCache.keys())) {
    if (key.startsWith(prefix)) rawCache.delete(key);
  }
  for (const key of Array.from(renderedCache.keys())) {
    if (key.startsWith(prefix)) renderedCache.delete(key);
  }
};
