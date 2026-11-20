import type { ProgressSource } from '@/types/book';

export interface RelocateSourceContext {
  reason?: string;
  currentSource: ProgressSource | undefined;
  initialRestoreDone: boolean;
  programmaticNavigation: boolean;
}

// A relocate is a real reader action only for page turns/snaps (gestures) or
// user navigation after the initial restore. `anchor` is reflow/TTS/selection
// re-anchoring and must never be promoted; `scroll` is also emitted by
// programmatic scrolling in fixed-layout books, so it needs a gesture that
// already flipped the source to user.
export const userRelocateSource = (ctx: RelocateSourceContext): 'user' | null => {
  const currentSource = ctx.currentSource ?? 'restore';
  if (ctx.reason === 'page' || ctx.reason === 'snap') return 'user';
  if (ctx.reason === 'scroll') return currentSource === 'user' ? 'user' : null;
  if (ctx.reason === 'navigation') {
    if (currentSource === 'remote') return null;
    if (!ctx.initialRestoreDone || ctx.programmaticNavigation) return null;
    return 'user';
  }
  return null;
};
