import React from 'react';
import { MdStar, MdStarBorder } from 'react-icons/md';

interface StarRatingInputProps {
  // MyBooks rating scale: 0-10, one star per unit — matches the read-only
  // display in StarRating.tsx and the mybooks webapp's <v-rating length="10">.
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

const RATING_LENGTH = 10;

// Clickable 10-star rating picker for a MyBooks book review, reusing the
// same icon set/scale as the read-only StarRating so the two look alike.
const StarRatingInput: React.FC<StarRatingInputProps> = ({ value, onChange, className }) => {
  const filled = Math.max(0, Math.min(RATING_LENGTH, Math.round(value)));
  return (
    <div className={className} role='radiogroup' aria-label={`${filled}/${RATING_LENGTH}`}>
      {Array.from({ length: RATING_LENGTH }, (_, i) => {
        const star = i + 1;
        return (
          <button
            key={i}
            type='button'
            role='radio'
            aria-checked={star === filled}
            aria-label={`${star}/${RATING_LENGTH}`}
            onClick={() => onChange(star)}
            className='eink-bordered inline-flex border-transparent p-0.5'
          >
            {star <= filled ? (
              <MdStar data-star='filled' className='text-yellow-500' />
            ) : (
              <MdStarBorder data-star='empty' className='text-yellow-500' />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default StarRatingInput;
