import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import StarRating from '@/components/StarRating';

afterEach(cleanup);

describe('StarRating', () => {
  it('renders 10 stars with the given rating filled', () => {
    const { container } = render(<StarRating rating={5} />);
    const stars = container.querySelectorAll('[data-star]');
    expect(stars).toHaveLength(10);
    expect(container.querySelectorAll('[data-star="filled"]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-star="empty"]')).toHaveLength(5);
  });

  it('clamps ratings above 10', () => {
    const { container } = render(<StarRating rating={15} />);
    expect(container.querySelectorAll('[data-star="filled"]')).toHaveLength(10);
  });
});
