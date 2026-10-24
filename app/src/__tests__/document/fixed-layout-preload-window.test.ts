// Regression: canvas-rendered (pdf.js) pages get a symmetric preload window,
// while every other fixed-layout book keeps the old forward-only formula.

import { describe, expect, it } from 'vitest';

import { preloadSpreadWindow } from 'foliate-js/fixed-layout.js';

describe('preloadSpreadWindow', () => {
  it('gives canvas-rendered (pdf.js) books a symmetric, non-zero backward window', () => {
    expect(preloadSpreadWindow({ canvasRendered: true, numPrerenderedSpreads: 1 })).toEqual({
      forward: 2,
      backward: 2,
    });
  });

  it('keeps the generic window for every other fixed-layout book', () => {
    // The historical default: one spread of forward lead, none backward.
    expect(preloadSpreadWindow({ canvasRendered: false, numPrerenderedSpreads: 1 })).toEqual({
      forward: 1,
      backward: 0,
    });
  });

  it('splits a larger generic window forward-first', () => {
    expect(preloadSpreadWindow({ canvasRendered: false, numPrerenderedSpreads: 3 })).toEqual({
      forward: 2,
      backward: 1,
    });
    expect(preloadSpreadWindow({ canvasRendered: false, numPrerenderedSpreads: 5 })).toEqual({
      forward: 4,
      backward: 1,
    });
  });
});
