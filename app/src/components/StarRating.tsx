import React from 'react';
import { MdStar, MdStarBorder } from 'react-icons/md';

interface StarRatingProps {
  // MyBooks stores ratings on a 0-10 scale (matches the mybooks
  // <v-rating length="10"> display used on the server-side web UI), but the
  // MyReader UI shows 5 stars. Convert here, in the display layer only —
  // callers keep passing the raw 0-10 value straight from MyBooks.
  rating: number;
  className?: string;
}

const RATING_LENGTH = 5;

// Read-only 5-star rating display for a MyBooks book. Converts the backend's
// 0-10 rating to a 0-5 star count (rounded, no half stars); MyBooks itself
// is untouched and keeps storing/serving the 0-10 value.
const StarRating: React.FC<StarRatingProps> = ({ rating, className }) => {
  const filled = Math.max(0, Math.min(RATING_LENGTH, Math.round(rating / 2)));
  return (
    <div className={className} aria-label={`${filled}/${RATING_LENGTH}`}>
      {Array.from({ length: RATING_LENGTH }, (_, i) =>
        i < filled ? (
          <MdStar key={i} data-star='filled' className='inline text-yellow-500' />
        ) : (
          <MdStarBorder key={i} data-star='empty' className='inline text-yellow-500' />
        ),
      )}
    </div>
  );
};

export default StarRating;
