import { SectionItem } from '@/libs/document';
import { transformContent } from '@/services/transformService';
import { TransformContext } from '@/services/transformers/types';
import { FoliateView } from '@/types/view';
import { findContentByIndex, isChunkDocument } from './ttsContent';

export interface TTSDocumentProviderOptions {
  view: FoliateView;
  createTransformContext: (content: string, sectionHref?: string) => TransformContext | null;
  getTransformSignature: () => string;
  // The loader's `loadContent()` is only the rendered text basis while the
  // reader's data transformers are still bound (the store settings exist).
  // After the book closes (headless playback) they emit raw XHTML, so the
  // provider must fall back to raw + the snapshotted transform pipeline.
  hasLiveTransforms?: () => boolean;
}

const parseBookDocument = (html: string): Document | null => {
  try {
    // The live view assigns the transformed XHTML to `iframe.srcdoc`, so the
    // browser parses it with the HTML parser. Match that parser here; an
    // XML parser can produce different node paths / text nodes.
    return new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
};

/**
 * Builds documents for TTS that match the text basis of the rendered view.
 *
 * `section.createDocument()` parses the raw XHTML and bypasses the app's
 * content transformers, so CFIs computed from it do not line up with the
 * rendered document (whitespace folding, 简繁, punctuation, warichu, …).
 * Prefer a live rendered document; otherwise reuse the loader's transformed
 * HTML (`loadContent`) and fall back to raw + the shared transform pipeline.
 */
export class TTSDocumentProvider {
  #view: FoliateView;
  #createTransformContext: TTSDocumentProviderOptions['createTransformContext'];
  #getTransformSignature: TTSDocumentProviderOptions['getTransformSignature'];
  #hasLiveTransforms: () => boolean;
  #cache = new Map<number, { signature: string; doc: Document }>();

  constructor(options: TTSDocumentProviderOptions) {
    this.#view = options.view;
    this.#createTransformContext = options.createTransformContext;
    this.#getTransformSignature = options.getTransformSignature;
    this.#hasLiveTransforms = options.hasLiveTransforms ?? (() => true);
  }

  getLiveDocument(index: number): Document | null {
    try {
      const renderer = this.#view.renderer;
      if (!renderer?.getContents) return null;
      const doc = findContentByIndex(renderer.getContents(), index)?.doc;
      return doc && !isChunkDocument(doc) ? doc : null;
    } catch {
      return null;
    }
  }

  async createSectionDocument(
    index: number,
    { preferLive = true, cache = true }: { preferLive?: boolean; cache?: boolean } = {},
  ): Promise<Document | null> {
    if (preferLive) {
      const live = this.getLiveDocument(index);
      if (live) return live;
    }

    const signature = this.#getTransformSignature();
    if (cache) {
      const cached = this.#cache.get(index);
      if (cached?.signature === signature) return cached.doc;
    }

    const section = this.#view.book.sections?.[index] as SectionItem | undefined;
    if (!section) return null;

    let doc: Document | null = null;
    // loadContent() has no matching unload of its own; when it had to load an
    // uncached section it pins that section's HTML + blob URLs until unload().
    // Hold a loader reference across it and release it below, so enumerating
    // every section for a whole-book download does not keep the whole book in
    // memory (and never upsets the view's own reference counting).
    let loadHeld = false;
    const useLoaderPath = !!section.load && !!section.loadContent && this.#hasLiveTransforms();
    try {
      // The live view renders `loadContent()` (the loader's serialized XHTML
      // after href replacement and the data-event transforms), so this is the
      // exact text basis a CFI from the rendered document expects.
      if (useLoaderPath) {
        try {
          await section.load?.();
          loadHeld = true;
        } catch {
          loadHeld = false;
        }
      }
      // A section with load() but a failed load must not fall through to
      // loadContent(), which would take an unbalanced loader reference.
      const html = useLoaderPath && loadHeld ? await section.loadContent?.() : undefined;
      if (html) doc = parseBookDocument(html);

      // Formats without a loader path: raw text + the shared transform
      // pipeline. Skip the pipeline when the book has no transformTarget
      // (the live render is untransformed in that case).
      if (!doc) {
        const raw = await section.loadText?.();
        if (raw) {
          const ctx = this.#view.book.transformTarget
            ? this.#createTransformContext(raw, section.href ?? section.id)
            : null;
          doc = parseBookDocument(ctx ? await transformContent(ctx) : raw);
        }
      }

      if (!doc && section.createDocument) {
        doc = await section.createDocument();
      }
    } catch (err) {
      console.warn('[TTS] failed to build a transformed section document', index, err);
    } finally {
      if (loadHeld) section.unload?.();
    }

    if (doc && cache) {
      // Re-insert so a refreshed entry moves to the newest slot; a plain set
      // keeps the original insertion order and could evict the fresh doc.
      this.#cache.delete(index);
      this.#cache.set(index, { signature, doc });
      // Keep only a small ring (current + adjacent sections): a long listen
      // session otherwise retains one parsed DOM per chapter.
      while (this.#cache.size > 2) {
        const oldest = this.#cache.keys().next().value;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
    }
    return doc;
  }

  clear(): void {
    this.#cache.clear();
  }
}
