import { ViewSettings } from '@/types/book';
import { transformContent } from '@/services/transformService';
import { TransformContext } from '@/services/transformers/types';

// Keep this list in the same order as the live section loader. Any document
// that is used to resolve CFIs from the rendered view must go through the same
// transforms or character offsets / DOM shapes will differ.
export const BOOK_CONTENT_TRANSFORMERS = [
  // MathML first: later stages (and foliate's own HTML parsing of `srcdoc`)
  // only recognize the canonical, unprefixed spelling.
  'mathml',
  'style',
  'punctuation',
  'footnote',
  'whitespace',
  'language',
  // TeX runs are rendered after the text-normalizing stages, so their source
  // is not rewritten (punctuation, 简繁) mid-formula.
  'latex',
  'sanitizer',
  'simplecc',
  'nbsp',
  'proofread',
  'warichu',
];

export interface BookContentTransformOptions {
  bookKey: string;
  viewSettings: ViewSettings;
  userLocale: string;
  isFixedLayout: boolean;
  primaryLanguage?: string;
  width?: number;
  height?: number;
}

export const createBookContentTransformContext = (
  options: BookContentTransformOptions,
  content: string,
  sectionHref?: string,
): TransformContext => ({
  ...options,
  content,
  sectionHref,
  transformers: BOOK_CONTENT_TRANSFORMERS,
});

export const transformBookContent = async (
  options: BookContentTransformOptions,
  content: string,
  sectionHref?: string,
): Promise<string> =>
  transformContent(createBookContentTransformContext(options, content, sectionHref));
