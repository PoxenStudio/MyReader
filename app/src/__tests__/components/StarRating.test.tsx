import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import StarRating from '@/components/StarRating';

afterEach(cleanup);

describe('StarRating', () => {
  it('renders 5 stars, converting the MyBooks 0-10 rating by rounding rating/2', () => {
    const { container } = render(<StarRating rating={5} />);
    const stars = container.querySelectorAll('[data-star]');
    expect(stars).toHaveLength(5);
    // 5 / 2 = 2.5, rounds up to 3
    expect(container.querySelectorAll('[data-star="filled"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-star="empty"]')).toHaveLength(2);
  });

  it('rounds 1 and 2 down to a single star', () => {
    const { container: c1 } = render(<StarRating rating={1} />);
    expect(c1.querySelectorAll('[data-star="filled"]')).toHaveLength(1);
    cleanup();

    const { container: c2 } = render(<StarRating rating={2} />);
    expect(c2.querySelectorAll('[data-star="filled"]')).toHaveLength(1);
  });

  it('clamps ratings above 10', () => {
    const { container } = render(<StarRating rating={15} />);
    expect(container.querySelectorAll('[data-star="filled"]')).toHaveLength(5);
  });
});
