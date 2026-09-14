import { Book } from '@/types/book';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

export const isTranslationAvailable = (book?: Book | null, targetLanguage?: string | null) => {
  if (!book || book.format === 'PDF') {
    return false;
  }

  const primaryLanguage = book.primaryLanguage || '';
  if (!primaryLanguage || primaryLanguage.toLowerCase() === 'und') {
    return false;
  }

  if (targetLanguage && isSameLang(primaryLanguage, targetLanguage)) {
    return false;
  }

  if (!targetLanguage && isSameLang(primaryLanguage, getLocale())) {
    return false;
  }

  return true;
};
