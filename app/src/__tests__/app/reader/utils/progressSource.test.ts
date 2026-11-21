import { describe, expect, test } from 'vitest';
import { userRelocateSource } from '@/app/reader/utils/progressSource';

describe('userRelocateSource', () => {
  test('promotes gestures even after a remote apply', () => {
    expect(
      userRelocateSource({
        reason: 'page',
        currentSource: 'remote',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBe('user');
    expect(
      userRelocateSource({
        reason: 'snap',
        currentSource: 'restore',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBe('user');
  });

  test('never promotes reflow/anchor relocates', () => {
    expect(
      userRelocateSource({
        reason: 'anchor',
        currentSource: 'restore',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBeNull();
  });

  test('promotes user navigation only after restore and not programmatically', () => {
    const base = {
      reason: 'navigation',
      currentSource: 'restore' as const,
      initialRestoreDone: true,
      programmaticNavigation: false,
    };
    expect(userRelocateSource(base)).toBe('user');
    expect(userRelocateSource({ ...base, initialRestoreDone: false })).toBeNull();
    expect(userRelocateSource({ ...base, programmaticNavigation: true })).toBeNull();
    expect(userRelocateSource({ ...base, currentSource: 'remote' })).toBeNull();
  });

  test('scroll needs a real gesture (source already user)', () => {
    expect(
      userRelocateSource({
        reason: 'scroll',
        currentSource: 'user',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBe('user');
    expect(
      userRelocateSource({
        reason: 'scroll',
        currentSource: 'restore',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBeNull();
    expect(
      userRelocateSource({
        reason: 'scroll',
        currentSource: 'remote',
        initialRestoreDone: true,
        programmaticNavigation: false,
      }),
    ).toBeNull();
  });
});
