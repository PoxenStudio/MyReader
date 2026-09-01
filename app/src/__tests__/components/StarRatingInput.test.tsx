import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import StarRatingInput from '@/components/StarRatingInput';

afterEach(cleanup);

describe('StarRatingInput', () => {
  it('renders 5 stars, converting the MyBooks 0-10 value by rounding value/2', () => {
    const { container } = render(<StarRatingInput value={5} onChange={() => {}} />);
    const stars = container.querySelectorAll('[data-star]');
    expect(stars).toHaveLength(5);
    // 5 / 2 = 2.5, rounds up to 3
    expect(container.querySelectorAll('[data-star="filled"]')).toHaveLength(3);
  });

  it('emits a 0-10 value (star index * 2) on click, not the displayed star count', () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(<StarRatingInput value={0} onChange={onChange} />);
    const stars = getAllByRole('radio');
    fireEvent.click(stars[3]!); // 4th star
    expect(onChange).toHaveBeenCalledWith(8);
  });
});
