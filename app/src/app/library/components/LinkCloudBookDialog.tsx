'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdCheckCircle, MdOutlineRadioButtonUnchecked } from 'react-icons/md';
import BookCover from '@/components/BookCover';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import { Book } from '@/types/book';
import { convertMyBooksToLocalBook } from '@/utils/bookConverter';
import { searchBooks, type MyBooksBook } from '@/services/mybooksService';

interface LinkCloudBookDialogProps {
  isOpen: boolean;
  book: Book | null;
  onClose: () => void;
}

const SEARCH_PAGE_SIZE = 30;

const LinkCloudBookDialog: React.FC<LinkCloudBookDialogProps> = ({ isOpen, book, onClose }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { updateBook, getBookByHash } = useLibraryStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MyBooksBook[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linking, setLinking] = useState(false);

  const search = useCallback(
    async (title: string, cancelled: () => boolean) => {
      setLoading(true);
      setError(null);
      setResults([]);
      setSelectedId(null);
      try {
        const { books } = await searchBooks(title, 1, SEARCH_PAGE_SIZE);
        if (!cancelled()) setResults(books);
      } catch (e) {
        if (!cancelled()) {
          console.error('[LinkCloudBookDialog] Failed to search cloud books:', e);
          setError(
            (e as { err?: string } | null)?.err === 'user.need_login'
              ? _('Sign in to link cloud books')
              : _('Failed to search cloud books'),
          );
        }
      } finally {
        if (!cancelled()) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!isOpen || !book) return;
    let cancelled = false;
    search(book.title.trim(), () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [isOpen, book, search]);

  const resultBooks = useMemo(
    () => results.map((cloudBook) => convertMyBooksToLocalBook(cloudBook)),
    [results],
  );

  if (!book) return null;

  const selectedBook = results.find((cloudBook) => cloudBook.id === selectedId) ?? null;

  const handleLink = async () => {
    if (!selectedBook || linking) return;
    setLinking(true);
    try {
      const latestBook = getBookByHash(book.hash) ?? book;
      await updateBook(envConfig, { ...latestBook, bookId: selectedBook.id });
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Linked to cloud book: {{title}}', { title: selectedBook.title }),
      });
      onClose();
    } catch (e) {
      console.error('[LinkCloudBookDialog] Failed to link cloud book:', e);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message:
          (e as { err?: string } | null)?.err === 'user.need_login'
            ? _('Sign in to link cloud books')
            : _('Failed to link cloud book'),
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Link Cloud Book')}
      boxClassName='sm:!h-auto sm:max-h-[80%] sm:min-w-[480px] sm:max-w-[520px]'
      contentClassName='!my-0 !flex !overflow-hidden min-h-0 flex-col !px-0 !pb-0 !pt-0'
    >
      <div className='flex min-h-0 flex-1 flex-col'>
        <p className='text-base-content/60 line-clamp-2 px-5 pb-3 pt-1 text-[0.85em]'>
          {_('Searching MyBooks by title: {{title}}', { title: book.title })}
        </p>

        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-5'>
          {loading ? (
            <div className='flex justify-center py-8'>
              <span className='loading loading-spinner loading-md' />
            </div>
          ) : error ? (
            <div className='flex flex-col items-center gap-3 py-8'>
              <p className='text-base-content/60 text-center text-sm'>{error}</p>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={() => search(book.title.trim(), () => false)}
              >
                {_('Retry')}
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className='flex justify-center py-8'>
              <p className='text-base-content/60 text-center text-sm'>
                {_('No matching books found')}
              </p>
            </div>
          ) : (
            <ul
              className={clsx(
                'eink-bordered bg-base-200/40 border-base-300/60 flex flex-col overflow-hidden rounded-xl border',
                'divide-base-300/50 divide-y',
              )}
            >
              {results.map((cloudBook, index) => {
                const selected = cloudBook.id === selectedId;
                return (
                  <li key={cloudBook.id}>
                    <button
                      type='button'
                      className={clsx(
                        'visible-focus-inset-2 flex min-h-14 w-full touch-manipulation select-none items-center gap-3 px-3 py-2 text-left',
                        'hover:bg-base-300/50 active:bg-base-300/70',
                        selected && 'bg-primary/10',
                      )}
                      onClick={() => setSelectedId(cloudBook.id)}
                    >
                      <div className='relative flex h-[52px] w-9 shrink-0 items-center justify-center overflow-hidden rounded'>
                        <BookCover
                          mode='list'
                          book={resultBooks[index]!}
                          coverFit='crop'
                          imageClassName='rounded'
                        />
                      </div>
                      <div className='min-w-0 flex-1'>
                        <p className='line-clamp-2 text-sm font-semibold leading-snug'>
                          {cloudBook.title}
                        </p>
                        <p className='text-neutral-content line-clamp-1 text-xs'>
                          {cloudBook.author || ''}
                        </p>
                      </div>
                      <span className='shrink-0' aria-hidden='true'>
                        {selected ? (
                          <MdCheckCircle className='fill-blue-500' size={20} />
                        ) : (
                          <MdOutlineRadioButtonUnchecked
                            className='fill-base-content/30'
                            size={20}
                          />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className='flex justify-end gap-2 px-5 pb-4 pt-3'>
          <button type='button' onClick={onClose} className='btn btn-ghost btn-sm eink-bordered'>
            {_('Cancel')}
          </button>
          <button
            type='button'
            onClick={handleLink}
            disabled={!selectedBook || linking}
            className='btn btn-primary btn-sm eink-bordered'
          >
            {linking ? <span className='loading loading-spinner loading-xs' /> : _('Link')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default LinkCloudBookDialog;
