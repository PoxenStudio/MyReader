'use client';

import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import StarRatingInput from '@/components/StarRatingInput';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { Book } from '@/types/book';
import { getMyBooksId } from '@/utils/bookConverter';
import { getOwnReview, submitReview } from '@/services/mybooksService';

interface BookReviewDialogProps {
  isOpen: boolean;
  book: Book | null;
  onClose: () => void;
}

// Default rating for a brand-new review — mirrors mybooks' BookReviewDialog.vue,
// which pre-fills 8 stars so most users only need to hit submit.
const DEFAULT_RATING = 8;
const COMMENT_MAX_LENGTH = 500;

const BookReviewDialog: React.FC<BookReviewDialogProps> = ({ isOpen, book, onClose }) => {
  const _ = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState(DEFAULT_RATING);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isOpen || !book) return;
    const bookId = getMyBooksId(book);
    if (!bookId) return;
    setLoading(true);
    getOwnReview(bookId)
      .then((review) => {
        if (review) {
          setRating(review.rating || 0);
          setComment(review.comment || '');
        } else {
          setRating(DEFAULT_RATING);
          setComment('');
        }
      })
      // Prefill failures shouldn't block the user from just rating the book.
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, book]);

  if (!book) return null;

  const handleSubmit = async () => {
    if (saving || rating === 0) return;
    const bookId = getMyBooksId(book);
    if (!bookId) return;

    setSaving(true);
    try {
      await submitReview(bookId, rating, comment);
      eventDispatcher.dispatch('toast', { type: 'success', message: _('Review saved') });
      onClose();
    } catch (e) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: e instanceof Error ? e.message : _('Failed to save review'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Write a Review')}
      boxClassName='sm:min-w-[420px]'
    >
      <div className='flex flex-col gap-y-3 pb-4'>
        {loading ? (
          <div className='flex justify-center py-8'>
            <span className='loading loading-spinner loading-md' />
          </div>
        ) : (
          <>
            <div className='flex justify-center'>
              <StarRatingInput value={rating} onChange={setRating} className='text-2xl' />
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
              maxLength={COMMENT_MAX_LENGTH}
              rows={3}
              placeholder={_('Share your thoughts about this book (optional)')}
              className='textarea eink-bordered w-full resize-none text-sm'
            />
            <div className='text-base-content/60 text-right text-xs'>
              {comment.length}/{COMMENT_MAX_LENGTH}
            </div>
          </>
        )}

        <div className='mt-2 flex justify-end gap-2'>
          <button type='button' onClick={onClose} className='btn btn-ghost btn-sm eink-bordered'>
            {_('Cancel')}
          </button>
          <button
            type='button'
            onClick={handleSubmit}
            disabled={rating === 0 || saving || loading}
            className='btn btn-primary btn-sm eink-bordered'
          >
            {saving ? <span className='loading loading-spinner loading-xs' /> : _('Submit Review')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default BookReviewDialog;
