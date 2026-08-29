import React from 'react';
import { MdStar, MdStarBorder } from 'react-icons/md';

interface StarRatingInputProps {
  // `value`/`onChange` stay on MyBooks' 0-10 rating scale — matches the
  // read-only display in StarRating.tsx and the mybooks webapp's
  // <v-rating length="10">. The 5-star UI is a display-layer conversion
  // only: onChange still emits a 0-10 value (star count * 2) so callers
  // (BookReviewDialog, submitReview) don't need to change.
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

const RATING_LENGTH = 5;
const RATING_SCALE = 2; // MyBooks rating units per displayed star

// Clickable 5-star rating picker for a MyBooks book review, reusing the
// same icon set as the read-only StarRating so the two look alike.
const StarRatingInput: React.FC<StarRatingInputProps> = ({ value, onChange, className }) => {
  const filled = Math.max(0, Math.min(RATING_LENGTH, Math.round(value / RATING_SCALE)));
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
            onClick={() => onChange(star * RATING_SCALE)}
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
