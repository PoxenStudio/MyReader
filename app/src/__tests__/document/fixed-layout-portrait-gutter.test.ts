// Regression test for: in fixed-layout books (PDF / fixed-layout EPUB /
// comics) with "Auto Spread" selected, when the window is too narrow to show
// two pages the renderer already collapses to showing a single page
// ("portrait" mode in fixed-layout.js), but that single page kept the
// asymmetric gutter margin from its left/right identity in the underlying
// two-page spread pairing. Since that identity alternates as you turn pages,
// the single visible page jumped between hugging the right edge and hugging
// the left edge on every turn.
//
// The fix centers the single visible page symmetrically in portrait mode,
// same as a true `pageSpread: 'center'` section, regardless of whether it
// was paired as the spread's left or right member.
import { describe, expect, it } from 'vitest';

import { computeSpreadInlineMargins as getSpreadGutterStyles } from 'foliate-js/fixed-layout.js';

describe('getSpreadGutterStyles', () => {
  it('hugs the gutter asymmetrically in landscape (real two-page spread)', () => {
    const styles = getSpreadGutterStyles(false);

    expect(styles.left).toEqual({ marginInlineStart: 'auto', marginInlineEnd: '' });
    expect(styles.right).toEqual({ marginInlineStart: '', marginInlineEnd: 'auto' });
  });

  it('centers both the left and right slot identically in portrait (single visible page)', () => {
    const styles = getSpreadGutterStyles(true);

    expect(styles.left).toEqual({ marginInlineStart: 'auto', marginInlineEnd: 'auto' });
    expect(styles.right).toEqual({ marginInlineStart: 'auto', marginInlineEnd: 'auto' });
    // Whichever of the two ends up visible, its styling must be identical —
    // that's what stops the page from jumping position across a page turn.
    expect(styles.left).toEqual(styles.right);
  });

  it('always specifies both margin properties so a reused frame element never keeps a stale value from a prior render', () => {
    for (const portrait of [false, true]) {
      const styles = getSpreadGutterStyles(portrait);
      for (const side of [styles.left, styles.right]) {
        expect(side).toHaveProperty('marginInlineStart');
        expect(side).toHaveProperty('marginInlineEnd');
      }
    }
  });
});
