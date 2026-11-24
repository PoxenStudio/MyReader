import React, { useEffect, useRef } from 'react';

import { renderStrokes } from '@/services/handwriting/renderer';
import type { PageRect } from '@/services/handwriting/coords';
import type { InkLayer } from '../../hooks/useHandwriting';

interface HandwritingCanvasProps {
  /** Ink to draw, each layer normalized to its own rect in viewport coordinates. */
  layers: InkLayer[];
  /** The overlay's own bounds; the canvas covers it. */
  cellRect: PageRect;
  interactive: boolean;
  overlayRef: (el: HTMLDivElement | null) => void;
  attach: (el: HTMLElement | null) => void;
  detach: () => void;
}

/**
 * Renders committed + in-progress ink on a canvas positioned over the
 * reader viewport. Purely a rendering + input-capture surface: all state
 * lives in useHandwriting/HandwritingService, so this re-renders on prop
 * changes only, never on its own timers.
 */
const HandwritingCanvas: React.FC<HandwritingCanvasProps> = ({
  layers,
  cellRect,
  interactive,
  overlayRef,
  attach,
  detach,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Last painted backing size and whether it was empty, so a page turn in a
  // book with no ink does not clear/repaint the cell on every render.
  const paintedRef = useRef<{ width: number; height: number; empty: boolean } | null>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = Math.max(1, Math.round(cellRect.width * dpr));
    const height = Math.max(1, Math.round(cellRect.height * dpr));
    const empty = layers.every((layer) => layer.strokes.length === 0);
    const painted = paintedRef.current;
    if (
      !interactive &&
      empty &&
      painted?.empty &&
      painted.width === width &&
      painted.height === height
    ) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cellRect.width, cellRect.height);
    for (const { strokes, rect } of layers) {
      renderStrokes(
        ctx,
        strokes,
        {
          left: rect.left - cellRect.left,
          top: rect.top - cellRect.top,
          width: rect.width,
          height: rect.height,
        },
        false,
      );
    }
    paintedRef.current = { width, height, empty };
  }, [layers, cellRect, dpr, interactive]);

  useEffect(() => {
    if (!interactive) return;
    const el = canvasRef.current;
    void attach(el);
    return () => {
      void detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // With no ink on the page and the pen off there is nothing to show. Painted
  // anyway, this cell-wide layer kept Chromium from seeing the pointer over
  // scrolled mode's overlay scrollbar, which faded mid-drag and lost the drag
  // (#7796). `visibility` keeps the box laid out, so `cellRect` still measures.
  const idle = !interactive && layers.every((layer) => layer.strokes.length === 0);

  return (
    <div
      ref={overlayRef}
      // Above the page and its hover header band while drawing (the dock sits
      // at z-30 over this); idle ink stays below all chrome.
      className={
        interactive
          ? 'pointer-events-none absolute inset-0 z-20'
          : 'pointer-events-none absolute inset-0'
      }
      style={{
        touchAction: interactive ? 'none' : undefined,
        visibility: idle ? 'hidden' : undefined,
      }}
    >
      <canvas
        ref={canvasRef}
        className={interactive ? 'pointer-events-auto absolute inset-0' : 'absolute inset-0'}
        style={{
          width: cellRect.width,
          height: cellRect.height,
          touchAction: 'none',
          // Nothing to select here; keeps iOS selection gestures off the Pencil.
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      />
    </div>
  );
};

export default HandwritingCanvas;
