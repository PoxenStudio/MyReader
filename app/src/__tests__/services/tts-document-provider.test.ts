import { beforeEach, describe, expect, test, vi } from 'vitest';
import { TTSDocumentProvider } from '@/services/tts/ttsDocumentProvider';
import { TransformContext } from '@/services/transformers/types';
import { FoliateView } from '@/types/view';
import { ViewSettings } from '@/types/book';

const { transformContent } = vi.hoisted(() => ({ transformContent: vi.fn() }));

vi.mock('@/services/transformService', () => ({ transformContent }));

const doc = (text: string): Document =>
  new DOMParser().parseFromString(`<html><body><p>${text}</p></body></html>`, 'text/html');

const makeContext = (content: string, sectionHref?: string): TransformContext => ({
  bookKey: 'book-1',
  viewSettings: {} as ViewSettings,
  userLocale: 'en',
  isFixedLayout: false,
  content,
  sectionHref,
  transformers: [],
});

describe('TTSDocumentProvider', () => {
  let signature: string;
  let provider: TTSDocumentProvider;
  let liveDoc: Document;
  let section1: Record<string, ReturnType<typeof vi.fn>>;
  let section2: Record<string, ReturnType<typeof vi.fn>>;
  let section3: Record<string, ReturnType<typeof vi.fn>>;
  let createSection3: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signature = 'sig-1';
    liveDoc = doc('live zero');
    section1 = {
      load: vi.fn().mockResolvedValue('blob:one'),
      unload: vi.fn(),
      loadContent: vi.fn().mockResolvedValue('<html><body><p>loaded one</p></body></html>'),
      createDocument: vi.fn().mockResolvedValue(doc('created one')),
    };
    section2 = {
      loadText: vi.fn().mockResolvedValue('<html><body><p>raw two</p></body></html>'),
      createDocument: vi.fn().mockResolvedValue(doc('created two')),
    };
    createSection3 = vi.fn().mockResolvedValue(doc('created three'));
    section3 = { createDocument: createSection3 };
    const view = {
      renderer: {
        getContents: () => [{ doc: liveDoc, index: 0 }],
      },
      book: {
        transformTarget: new EventTarget(),
        sections: [
          { href: 's0.xhtml', createDocument: vi.fn().mockResolvedValue(liveDoc) },
          { href: 's1.xhtml', ...section1 },
          { href: 's2.xhtml', ...section2 },
          { href: 's3.xhtml', ...section3 },
        ],
      },
    } as unknown as FoliateView;
    provider = new TTSDocumentProvider({
      view,
      createTransformContext: makeContext,
      getTransformSignature: () => signature,
    });
    transformContent.mockReset();
  });

  test('prefers a live rendered document', async () => {
    await expect(provider.createSectionDocument(0)).resolves.toBe(liveDoc);
    expect(section1['loadContent']).not.toHaveBeenCalled();
  });

  test('parses the loader-transformed HTML without re-running transforms', async () => {
    const result = await provider.createSectionDocument(1, { preferLive: false });
    expect(result?.body.textContent).toBe('loaded one');
    expect(transformContent).not.toHaveBeenCalled();
  });

  test('holds and releases a loader reference around loadContent', async () => {
    const load = vi.fn().mockResolvedValue('blob:one');
    const unload = vi.fn();
    const view = {
      renderer: { getContents: () => [] },
      book: {
        transformTarget: new EventTarget(),
        sections: [
          {
            href: 's1.xhtml',
            load,
            unload,
            loadContent: vi.fn().mockResolvedValue('<html><body><p>loaded</p></body></html>'),
          },
        ],
      },
    } as unknown as FoliateView;
    const loaderProvider = new TTSDocumentProvider({
      view,
      createTransformContext: makeContext,
      getTransformSignature: () => signature,
    });

    await loaderProvider.createSectionDocument(0, { preferLive: false, cache: false });

    expect(load).toHaveBeenCalledTimes(1);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  test('skips the loader path when the reader transforms are detached', async () => {
    const load = vi.fn();
    const loadContent = vi.fn().mockResolvedValue('<html><body><p>raw one</p></body></html>');
    const unload = vi.fn();
    const view = {
      renderer: { getContents: () => [] },
      book: {
        transformTarget: new EventTarget(),
        sections: [
          {
            href: 's1.xhtml',
            load,
            unload,
            loadContent,
            loadText: vi.fn().mockResolvedValue('<html><body><p>raw one</p></body></html>'),
            createDocument: vi.fn(),
          },
        ],
      },
    } as unknown as FoliateView;
    const headlessProvider = new TTSDocumentProvider({
      view,
      createTransformContext: makeContext,
      getTransformSignature: () => signature,
      hasLiveTransforms: () => false,
    });
    transformContent.mockResolvedValue('<html><body><p>transformed one</p></body></html>');

    const result = await headlessProvider.createSectionDocument(0, { preferLive: false });

    // loadContent() would hand back untransformed XHTML once the view's data
    // transformers are gone, so headless must use raw + the shared pipeline.
    expect(result?.body.textContent).toBe('transformed one');
    expect(load).not.toHaveBeenCalled();
    expect(loadContent).not.toHaveBeenCalled();
    expect(unload).not.toHaveBeenCalled();
  });

  test('transforms raw text through the shared pipeline', async () => {
    transformContent.mockResolvedValue('<html><body><p>transformed two</p></body></html>');
    const result = await provider.createSectionDocument(2, { preferLive: false });
    expect(result?.body.textContent).toBe('transformed two');
    expect(transformContent).toHaveBeenCalledWith(
      expect.objectContaining({ content: '<html><body><p>raw two</p></body></html>' }),
    );
  });

  test('caches by transform signature', async () => {
    transformContent.mockResolvedValue('<html><body><p>transformed two</p></body></html>');
    await provider.createSectionDocument(2, { preferLive: false });
    await provider.createSectionDocument(2, { preferLive: false });
    expect(transformContent).toHaveBeenCalledTimes(1);

    signature = 'sig-2';
    await provider.createSectionDocument(2, { preferLive: false });
    expect(transformContent).toHaveBeenCalledTimes(2);
  });

  test('falls back to createDocument when no text loader exists', async () => {
    const result = await provider.createSectionDocument(3, { preferLive: false });
    expect(result?.body.textContent).toBe('created three');
    expect(createSection3).toHaveBeenCalledTimes(1);
  });
});
