import React, { useEffect, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { formatDate } from '@/utils/book';
import { getBookReadingStats, type MyBooksBookReadingStat } from '@/services/mybooksService';

interface BookReadingStatsBannerProps {
  bookId: number;
  format: string;
}

// Private-use-area sentinels swapped in for {{hours}}/{{minutes}} so the
// translated template can be split back apart and each number rendered as
// its own bold <span>, regardless of where the locale's word order puts it
// ("Read {{hours}} hr {{minutes}} min" vs "已读{{hours}}小时{{minutes}}分钟").
const HOURS_MARKER = '';
const MINUTES_MARKER = '';
const MARKER_RE = new RegExp(`(${HOURS_MARKER}|${MINUTES_MARKER})`);

/**
 * "阅读数据" banner shown above the metadata section: reading duration on the
 * left (minutes only under an hour, "H hr M min" from an hour up — both
 * numbers bold), start date on the right. Only the current format's stats
 * are shown — a book with multiple formats does not get a breakdown here.
 * Data source: `/api/book/<id>/reading_stats` (document/MyBooks_WebAPI.md
 * §3.49), filtered to `format`.
 */
const BookReadingStatsBanner: React.FC<BookReadingStatsBannerProps> = ({ bookId, format }) => {
  const _ = useTranslation();
  const [stat, setStat] = useState<MyBooksBookReadingStat | null>(null);

  useEffect(() => {
    if (!bookId || !format) {
      setStat(null);
      return;
    }
    let cancelled = false;
    getBookReadingStats(bookId, format)
      .then((stats) => {
        if (!cancelled) setStat(stats[0] ?? null);
      })
      // A failed fetch shouldn't block the rest of the detail view — just
      // show nothing, same as the no-stats-yet case below.
      .catch((e) => {
        console.warn('Failed to load book reading stats:', e);
        if (!cancelled) setStat(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, format]);

  if (!stat) return null;

  const totalMinutes = Math.round(stat.total_seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const durationTemplate =
    hours > 0
      ? _('Read {{hours}} hr {{minutes}} min', { hours: HOURS_MARKER, minutes: MINUTES_MARKER })
      : _('Read {{minutes}} min', { minutes: MINUTES_MARKER });
  const durationValues: Record<string, number> = {
    [HOURS_MARKER]: hours,
    [MINUTES_MARKER]: minutes,
  };

  return (
    <div className='border-base-300/60 mb-3 flex items-center justify-between rounded-lg border px-4 py-3'>
      <span className='text-neutral-content text-sm'>
        {durationTemplate.split(MARKER_RE).map((part, i) =>
          part === HOURS_MARKER || part === MINUTES_MARKER ? (
            <span key={i} className='font-bold'>
              {durationValues[part]}
            </span>
          ) : (
            part
          ),
        )}
      </span>
      {stat.start_time && (
        <span className='text-neutral-content text-sm'>
          {_('Started {{date}}', { date: formatDate(stat.start_time, true) ?? '' })}
        </span>
      )}
    </div>
  );
};

export default BookReadingStatsBanner;
