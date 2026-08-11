import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMyBooksStatusStore, useIsOwnBooknote } from '@/store/mybooksStatusStore';

describe('mybooksStatusStore — showOtherAnnotations / currentUserId', () => {
  beforeEach(() => {
    localStorage.clear();
    useMyBooksStatusStore.setState({ showOtherAnnotations: true, currentUserId: null });
  });

  it('defaults showOtherAnnotations to true when nothing is cached', () => {
    expect(useMyBooksStatusStore.getState().showOtherAnnotations).toBe(true);
  });

  it('persists showOtherAnnotations to localStorage so it survives reload', () => {
    useMyBooksStatusStore.getState().setShowOtherAnnotations(false);
    expect(localStorage.getItem('mybooks_show_other_annotations')).toBe('false');
    useMyBooksStatusStore.setState({ showOtherAnnotations: true });
    // Re-reading the persisted value (as the store would on next app load).
    expect(localStorage.getItem('mybooks_show_other_annotations')).toBe('false');
  });

  it('setCurrentUserId updates the store', () => {
    useMyBooksStatusStore.getState().setCurrentUserId(42);
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(42);
  });
});

describe('useIsOwnBooknote', () => {
  beforeEach(() => {
    useMyBooksStatusStore.setState({ currentUserId: 42 });
  });

  it('treats a note with no userId (local/not-yet-synced) as own', () => {
    const { result } = renderHook(() => useIsOwnBooknote(undefined));
    expect(result.current).toBe(true);
  });

  it('treats a note whose userId matches the current user as own', () => {
    const { result } = renderHook(() => useIsOwnBooknote('42'));
    expect(result.current).toBe(true);
  });

  it('treats a note whose userId differs from the current user as not own', () => {
    const { result } = renderHook(() => useIsOwnBooknote('99'));
    expect(result.current).toBe(false);
  });

  it('treats any userId as not own when the current user id is unknown', () => {
    useMyBooksStatusStore.setState({ currentUserId: null });
    const { result } = renderHook(() => useIsOwnBooknote('99'));
    expect(result.current).toBe(false);
  });
});
