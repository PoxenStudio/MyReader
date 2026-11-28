// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HandwritingOverlay from '@/app/reader/components/handwriting/HandwritingOverlay';
import { eventDispatcher } from '@/utils/event';

const h = vi.hoisted(() => ({
  enabled: false,
  layers: [] as { strokes: unknown[]; rect: unknown }[],
  setHoveredBookKey: vi.fn(),
  setAutoScrollEnabled: vi.fn(),
  setErasing: vi.fn(),
  setEnabled: vi.fn(),
  hitTestResult: false,
}));

vi.mock('@/app/reader/hooks/useHandwriting', () => ({
  useHandwriting: () => ({
    visible: true,
    editable: true,
    enabled: h.enabled,
    setEnabled: h.setEnabled,
    hitTest: () => h.hitTestResult,
    layers: h.layers,
    cellRect: { left: 0, top: 0, width: 400, height: 800 },
    containerRef: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    erasing: false,
    setErasing: h.setErasing,
    undo: vi.fn(),
    redo: vi.fn(),
    turnPage: vi.fn(),
    penColor: '#1a1a1a',
    penWidth: 0.004,
    selectPenColor: vi.fn(),
    selectPenWidth: vi.fn(),
    tool: 'pen',
    selectTool: vi.fn(),
    saveDrawing: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

vi.mock('@/store/readerStore', () => {
  const state = {
    setHoveredBookKey: h.setHoveredBookKey,
    setAutoScrollEnabled: h.setAutoScrollEnabled,
  };
  return {
    useReaderStore: (select?: (s: typeof state) => unknown) => (select ? select(state) : state),
  };
});

vi.mock('@/app/reader/components/handwriting/HandwritingBars', () => ({
  HandwritingDock: () => <div data-testid='handwriting-dock' />,
}));

afterEach(() => {
  cleanup();
  h.layers = [];
  h.hitTestResult = false;
  h.setHoveredBookKey.mockClear();
  h.setAutoScrollEnabled.mockClear();
  h.setErasing.mockClear();
  h.setEnabled.mockClear();
});

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('HandwritingOverlay', () => {
  it('hides the header and footer when drawing starts, so they cannot cover the toolbar', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setHoveredBookKey).toHaveBeenCalledWith(null);
  });

  it('shows its dock in place of the reader footer, with no bar over the page top', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(screen.getByTestId('handwriting-dock')).toBeTruthy();
    expect(screen.queryByTestId('handwriting-top-bar')).toBeNull();
  });

  it('starts each drawing session with the pen, not the eraser left on last time', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setErasing).toHaveBeenCalledWith(false);
  });

  it('leaves the bars alone while not drawing', () => {
    h.enabled = false;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });

  it('opens drawing on a tap that lands on existing ink', () => {
    h.enabled = false;
    h.hitTestResult = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    act(() => {
      eventDispatcher.dispatchSync('iframe-single-click', {
        bookKey: 'book-1',
        windowX: 12,
        windowY: 34,
      });
    });
    expect(h.setEnabled).toHaveBeenCalledWith(true);
  });

  // The ink layer spans the whole book cell, scrolled mode's scrollbar
  // included. Painted while empty, it kept Chromium from seeing the pointer on
  // that overlay scrollbar, which then faded mid-drag and lost the drag (#7796).
  describe('cell-wide ink layer', () => {
    const inkLayer = () => document.querySelector('canvas')!.parentElement!;
    const rect = { left: 0, top: 0, width: 400, height: 800 };

    it('paints nothing while the page has no ink and the pen is off', () => {
      h.enabled = false;
      h.layers = [{ strokes: [], rect }];
      render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
      expect(getComputedStyle(inkLayer()).visibility).toBe('hidden');
    });

    it('shows the ink on the page', () => {
      h.enabled = false;
      h.layers = [{ strokes: [{ points: [[0.1, 0.1, 0.5]], width: 0.004, color: '#000' }], rect }];
      render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
      expect(getComputedStyle(inkLayer()).visibility).not.toBe('hidden');
    });

    it('takes the pen on a page with no ink yet', () => {
      h.enabled = true;
      h.layers = [{ strokes: [], rect }];
      render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
      expect(getComputedStyle(inkLayer()).visibility).not.toBe('hidden');
    });
  });
});
