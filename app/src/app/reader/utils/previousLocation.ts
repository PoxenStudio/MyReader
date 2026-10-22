import type { BookProgress } from '@/types/book';

// A chapter switch is treated as a deliberate jump when the previous view was
// not at the end of its chapter. After such a jump the reader can turn at most
// this many pages before we assume they have settled into the new chapter.
export const MAX_PAGES_AFTER_CHAPTER_SWITCH = 2;

export interface SectionPage {
  // Current page within the section (0-based) and the section's page count.
  page: number;
  pages: number;
}

export interface PreviousLocationTracker {
  // Chapter identity of the last observed progress. null until the first update.
  chapterKey: string | null;
  sectionIndex: number;
  page: number;
  // Whether the last observed progress was on the final page of its section.
  atChapterEnd: boolean;
  // Most recent location, used as the return target on the next chapter switch.
  lastLocation: string;
  // Location offered by the "back to previous location" prompt, or null when
  // there is nothing to return to (never switched, or the prompt expired).
  location: string | null;
  // Chapter the prompt returns to; returning there manually removes the prompt.
  targetChapterKey: string | null;
  pagesSinceSwitch: number;
}

export const createPreviousLocationTracker = (): PreviousLocationTracker => ({
  chapterKey: null,
  sectionIndex: -1,
  page: 0,
  atChapterEnd: false,
  lastLocation: '',
  location: null,
  targetChapterKey: null,
  pagesSinceSwitch: 0,
});

const getChapterKey = (progress: BookProgress): string =>
  progress.sectionHref || `section:${progress.index}`;

const isAtChapterEnd = (sectionPage?: SectionPage): boolean =>
  !!sectionPage && sectionPage.pages > 0 && sectionPage.page >= sectionPage.pages - 1;

const isAtChapterStart = (sectionPage?: SectionPage): boolean =>
  !sectionPage || sectionPage.pages <= 0 || sectionPage.page <= 0;

const advancePages = (
  tracker: PreviousLocationTracker,
  base: Pick<
    PreviousLocationTracker,
    'chapterKey' | 'sectionIndex' | 'page' | 'atChapterEnd' | 'lastLocation'
  >,
  turned: number,
): PreviousLocationTracker => {
  const pagesSinceSwitch = tracker.location ? tracker.pagesSinceSwitch + turned : 0;
  const expired = pagesSinceSwitch > MAX_PAGES_AFTER_CHAPTER_SWITCH;
  return {
    ...tracker,
    ...base,
    pagesSinceSwitch,
    location: expired ? null : tracker.location,
    targetChapterKey: expired ? null : tracker.targetChapterKey,
  };
};

export const updatePreviousLocationTracker = (
  tracker: PreviousLocationTracker,
  progress: BookProgress,
  sectionPage?: SectionPage,
): PreviousLocationTracker => {
  const chapterKey = getChapterKey(progress);
  const base = {
    chapterKey,
    sectionIndex: progress.index,
    page: progress.page,
    atChapterEnd: isAtChapterEnd(sectionPage),
    lastLocation: progress.location,
  };

  if (tracker.chapterKey === null) {
    return { ...tracker, ...base };
  }

  if (chapterKey === tracker.chapterKey) {
    if (progress.page === tracker.page) return { ...tracker, ...base };
    return advancePages(tracker, base, Math.abs(progress.page - tracker.page));
  }

  // Same section with a different TOC anchor, or a page turn from the last page
  // of one section into the first page of the next: the reader kept reading
  // instead of jumping, so it is not a chapter switch.
  const keptReading =
    progress.index === tracker.sectionIndex ||
    (tracker.atChapterEnd && isAtChapterStart(sectionPage));
  if (keptReading) {
    return advancePages(tracker, base, 1);
  }

  // Manually navigated back to the recorded chapter — nothing to return to.
  if (chapterKey === tracker.targetChapterKey) {
    return { ...tracker, ...base, location: null, targetChapterKey: null, pagesSinceSwitch: 0 };
  }

  // Consecutive switches keep the original return target so the reader can get
  // back to where they were before they started jumping between chapters.
  return {
    ...tracker,
    ...base,
    pagesSinceSwitch: 0,
    location: tracker.location ?? tracker.lastLocation,
    targetChapterKey: tracker.targetChapterKey ?? tracker.chapterKey,
  };
};
