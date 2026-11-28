import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  isOwnBooknoteId,
  useMyBooksStatusStore,
  useIsOwnBooknote,
} from '@/store/mybooksStatusStore';

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

  it('ignores a missing id instead of clobbering the known one', () => {
    // `/user/info` has no `id` field, so runtime callers can pass undefined.
    useMyBooksStatusStore.getState().setCurrentUserId(42);
    useMyBooksStatusStore.getState().setCurrentUserId(undefined as unknown as number);
    expect(useMyBooksStatusStore.getState().currentUserId).toBe(42);
  });

  it('clears the id on an explicit null', () => {
    useMyBooksStatusStore.getState().setCurrentUserId(42);
    useMyBooksStatusStore.getState().setCurrentUserId(null);
    expect(useMyBooksStatusStore.getState().currentUserId).toBeNull();
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

describe('isOwnBooknoteId (strict, no fail-open on unknown identity)', () => {
  it('treats unstamped notes as own', () => {
    expect(isOwnBooknoteId(undefined, null)).toBe(true);
    expect(isOwnBooknoteId(undefined, 42)).toBe(true);
  });

  it('matches only when a numeric identity is known', () => {
    expect(isOwnBooknoteId('42', 42)).toBe(true);
    expect(isOwnBooknoteId('42', null)).toBe(false);
    expect(isOwnBooknoteId('42', undefined)).toBe(false);
    expect(isOwnBooknoteId('99', 42)).toBe(false);
  });

  it('never treats the literal "null"/"undefined" stamp as own', () => {
    // Legacy payloads could stringify a null uid; `String(currentUserId)`
    // would then match. The helper must require a real numeric identity.
    expect(isOwnBooknoteId('null', null)).toBe(false);
    expect(isOwnBooknoteId('undefined', undefined)).toBe(false);
  });

  it('never treats the pulled "foreign" author sentinel as own', () => {
    expect(isOwnBooknoteId('foreign', 42)).toBe(false);
    expect(isOwnBooknoteId('foreign', null)).toBe(false);
  });
});

describe('cached currentUserId', () => {
  const loadStore = async () => {
    vi.resetModules();
    return (await import('@/store/mybooksStatusStore')).useMyBooksStatusStore;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('restores a logged-in numeric id from mybooks_user_info', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify({ id: 42, is_login: true }));
    const store = await loadStore();
    expect(store.getState().currentUserId).toBe(42);
  });

  it('ignores a cached id from a logged-out session', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify({ id: 42, is_login: false }));
    const store = await loadStore();
    expect(store.getState().currentUserId).toBeNull();
  });

  it('ignores a guest cache', async () => {
    localStorage.setItem(
      'mybooks_user_info',
      JSON.stringify({ id: 999999, is_login: false, is_guest: true }),
    );
    const store = await loadStore();
    expect(store.getState().currentUserId).toBeNull();
  });

  it('ignores a non-integer id', async () => {
    localStorage.setItem('mybooks_user_info', JSON.stringify({ id: 4.2, is_login: true }));
    const store = await loadStore();
    expect(store.getState().currentUserId).toBeNull();
  });
});
