import React from 'react';
import { MdStar, MdStarBorder } from 'react-icons/md';

interface StarRatingProps {
  // MyBooks rating scale: 0-10, one star per unit (matches the mybooks
  // <v-rating length="10"> display used on the server-side web UI).
  rating: number;
  className?: string;
}

const RATING_LENGTH = 10;

// Read-only 10-star rating display for a MyBooks book, mirroring the
// mybooks webapp's <v-rating length="10" readonly> widget.
const StarRating: React.FC<StarRatingProps> = ({ rating, className }) => {
  const filled = Math.max(0, Math.min(RATING_LENGTH, Math.round(rating)));
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
