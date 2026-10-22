import type {
  MyNexusMessageContext,
  MyNexusReadingContext,
  MyNexusSelectionContext,
} from '@/services/mybooksService';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import type { TextSelection } from '@/utils/sel';

const MAX_SELECTION_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

const cut = (value: string | undefined, limit: number): string | undefined => {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit) : value;
};

const squeeze = (value: string): string => value.replace(/\s+/g, ' ').trim();

const clampFraction = (value: number | undefined): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.min(1, Math.max(0, value));
};

export const buildReadingContext = (bookKey: string | null): MyNexusReadingContext | undefined => {
  if (!bookKey) return undefined;
  const progress = getBookProgress(bookKey);
  const bookTitle = useBookDataStore.getState().getBookData(bookKey)?.book?.title;
  if (!progress && !bookTitle) return undefined;

  const context: MyNexusReadingContext = {
    book_title: cut(bookTitle, MAX_TITLE_CHARS),
    chapter_title: cut(progress?.sectionLabel, MAX_TITLE_CHARS),
    chapter_href: cut(progress?.sectionHref, 500),
    section_index:
      typeof progress?.index === 'number' && progress.index >= 0 ? progress.index : undefined,
    progress_fraction: clampFraction(progress?.fraction),
    page: typeof progress?.page === 'number' && progress.page > 0 ? progress.page : undefined,
    cfi: cut(progress?.location, 500),
  };
  console.log(
    `[MyNexus] reading context book=${bookKey} chapter=${context.chapter_title ?? ''} section=${context.section_index ?? ''} fraction=${context.progress_fraction ?? ''}`,
  );
  return context;
};

export const buildSelectionContext = (
  bookKey: string | null,
  selection: TextSelection,
): MyNexusSelectionContext | undefined => {
  const text = cut(squeeze(selection.text), MAX_SELECTION_CHARS);
  if (!text) return undefined;
  const reading = buildReadingContext(bookKey);
  const context: MyNexusSelectionContext = {
    text,
    chapter_title: reading?.chapter_title,
    chapter_href: cut(selection.href, 500) ?? reading?.chapter_href,
    section_index:
      typeof selection.index === 'number' && selection.index >= 0
        ? selection.index
        : reading?.section_index,
    page: typeof selection.page === 'number' && selection.page > 0 ? selection.page : reading?.page,
    progress_fraction: reading?.progress_fraction,
    cfi: cut(selection.cfi, 500) ?? reading?.cfi,
  };
  console.log(
    `[MyNexus] selection context book=${bookKey} len=${text.length} chapter=${context.chapter_title ?? ''} section=${context.section_index ?? ''}`,
  );
  return context;
};

export const buildMessageContext = (
  bookKey: string | null,
  selection?: TextSelection,
): MyNexusMessageContext | undefined => {
  const reading = buildReadingContext(bookKey);
  const selectionContext = selection ? buildSelectionContext(bookKey, selection) : undefined;
  if (!reading && !selectionContext) return undefined;
  return { reading, selection: selectionContext };
};
