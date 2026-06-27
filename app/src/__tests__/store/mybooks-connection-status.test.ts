import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMyBooksStatusStore, useMyBooksConnectionStatus } from '@/store/mybooksStatusStore';

describe('useMyBooksConnectionStatus', () => {
  beforeEach(() => {
    localStorage.clear();
    useMyBooksStatusStore.setState({ isOffline: false, host: null });
  });

  it('is unconfigured when no host has ever been set', () => {
    const { result } = renderHook(() => useMyBooksConnectionStatus());
    expect(result.current).toBe('unconfigured');
  });

  it('is connected when a host is set and not offline', () => {
    useMyBooksStatusStore.getState().setHost('http://mybooks.local');
    const { result } = renderHook(() => useMyBooksConnectionStatus());
    expect(result.current).toBe('connected');
  });

  it('is unreachable when a host is set but marked offline', () => {
    useMyBooksStatusStore.getState().setHost('http://mybooks.local');
    useMyBooksStatusStore.getState().setOffline(true);
    const { result } = renderHook(() => useMyBooksConnectionStatus());
    expect(result.current).toBe('unreachable');
  });
});
