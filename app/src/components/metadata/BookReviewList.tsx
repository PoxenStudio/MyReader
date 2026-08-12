import React, { useEffect, useState } from 'react';
import { PiUserCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useMyBooksBookReviewAllowed } from '@/store/mybooksStatusStore';
import { getBookReviews, getMyBooksAvatarUrl, type MyBooksReview } from '@/services/mybooksService';
import { formatDate } from '@/utils/book';
import UserAvatar from '@/components/UserAvatar';
import StarRating from '@/components/StarRating';

interface BookReviewListProps {
  bookId: number;
}

// Read-only display of other readers' reviews for a cloud book — mirrors
// mybooks' BookReviewList.vue, minus the add/edit/delete affordances (those
// live in BookReviewDialog.tsx, reached from the bookshelf context menu).
const BookReviewList: React.FC<BookReviewListProps> = ({ bookId }) => {
  const _ = useTranslation();
  const reviewAllowed = useMyBooksBookReviewAllowed();
  const [reviews, setReviews] = useState<MyBooksReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reviewAllowed || !bookId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getBookReviews(bookId)
      .then((result) => setReviews(result.reviews))
      // A failed fetch shouldn't block the rest of the detail view — just
      // show nothing, same as the reviews-disabled/empty case below.
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bookId, reviewAllowed]);

  if (!reviewAllowed || loading || reviews.length === 0) return null;

  return (
    <div className='book-reviews mt-4'>
      <div className='px-4 py-3'>
        <span className='text-neutral-content/85 text-base font-semibold'>{_('Reviews')}</span>
      </div>
      <div className='divide-base-200 divide-y px-4'>
        {reviews.map((review) => (
          <div key={review.id} className='flex gap-3 py-3'>
            <span className='h-10 w-10 shrink-0'>
              <UserAvatar
                url={review.avatar ? getMyBooksAvatarUrl(review.avatar) : ''}
                size={40}
                DefaultIcon={PiUserCircle}
                fillContainer
              />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-bold'>{review.nickname || review.reader_id}</span>
                {review.status === 'pending' && (
                  <span className='badge badge-warning badge-sm'>{_('Pending Review')}</span>
                )}
                {review.update_time && (
                  <span className='text-neutral-content text-xs'>
                    {formatDate(review.update_time, true)}
                  </span>
                )}
              </div>
              <StarRating rating={review.rating} className='mt-0.5 text-sm' />
              {review.comment && (
                <p className='text-neutral-content mt-1 text-sm whitespace-pre-wrap break-words'>
                  {review.comment}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookReviewList;
